# frozen_string_literal: true

require "minitest/autorun"
require "base64"
require "zlib"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::ROOT)

module Mainz
  class RecipeTest < Minitest::Test
    def setup
      @directory = Pathname(Dir.mktmpdir("recipe-", Mainz.workspace("tmp/test/cli").to_s))
      @cli = File.expand_path(ENV.fetch("MAINZ_CLI"))
      @source = prepare("book", "width", 0.1)
      @other = prepare("other", "renamed", 0.15)
      @output = @directory.join("result.pdf")
    end

    def teardown
      FileUtils.remove_entry(@directory)
    end

    def test_apply_matches_multi_input_plan_and_independent_sources
      recipe = record
      recipe["inputs"]["other"] = {}
      recipe["sources"] = {
        "original" => {"input" => "book"},
        "fine" => {
          "input" => "book",
          "profiles" => [{"family" => "fixture", "name" => "Fine"}],
          "overrides" => [{"id" => "color", "value" => nil}]
        },
        "other" => {
          "input" => "other",
          "profiles" => [{"set" => "print", "id" => "fine"}],
          "overrides" => [{"family" => "fixture", "key" => "guide.width", "value" => 0.2}]
        }
      }
      pages = [
        {"source" => "original", "page" => 0},
        {"source" => "fine", "page" => 0},
        {"blank" => {"width" => 80, "height" => 100}},
        {"source" => "other", "page" => 0}
      ]
      recipe["parts"] = [{"pages" => pages, "copies" => 2, "front" => true}]
      expected = {
        "version" => 1,
        "sources" => {
          "original" => {"input" => "book", "overrides" => {}},
          "fine" => {"input" => "book", "overrides" => {"width" => 0.1}},
          "other" => {"input" => "other", "overrides" => {"renamed" => 0.2, "color" => "#112233"}}
        },
        "parts" => recipe["parts"]
      }
      result = run_recipe(recipe)
      direct = compose(expected, {"book" => @source, "other" => @other})
      assert_equal(direct.stdout, result.stdout)
      assert_equal(@directory.join("direct.pdf").binread, @output.binread)
      assert_empty(result.stderr)
      description = JSON.parse(command("describe", @output).stdout)
      assert_equal(8, description["pageCount"])
      assert_equal(
        [0.1, 0.2],
        description["parameters"]
          .values
          .filter_map { |entry|
            entry.dig("parameter", "value") if entry.dig("parameter", "binding", "property") == "stroke-width"
          }
          .sort
      )
    end

    def test_all_pages_uses_current_input_and_checks_exact_expectations
      recipe = record
      recipe["parts"][0] = {"pages" => [{"source" => "source", "pages" => "all"}], "copies" => 2, "front" => true}
      run_recipe(recipe)
      assert_equal(4, JSON.parse(command("describe", @output).stdout)["pageCount"])
      @output.delete
      enlarged = @directory.join("enlarged.pdf")
      plan = {
        "version" => 1,
        "sources" => {"source" => {"input" => "book", "overrides" => {}}},
        "parts" => [{"pages" => Array.new(3) { {"source" => "source", "page" => 0} }}]
      }
      compose(plan, {"book" => @source}, enlarged)
      FileUtils.cp(enlarged, @source)
      run_recipe(recipe)
      assert_equal(8, JSON.parse(command("describe", @output).stdout)["pageCount"])
      @output.delete
      recipe["inputs"]["book"]["pageCount"] = 1
      failure = run_recipe(recipe, status: 1)
      assert_equal("/inputs/book/pageCount", JSON.parse(failure.stderr)["location"])
      refute_path_exists(@output)
    end

    def test_changed_digest_warns_without_blocking_valid_replay
      recipe = record
      recipe["inputs"]["book"]["sha256"] = "0" * 64
      result = run_recipe(recipe)
      warning = JSON.parse(result.stderr)
      assert_equal("input-changed", warning["code"])
      assert_equal(Digest::SHA256.file(@source).hexdigest, warning["actual"])
      assert_equal(1, JSON.parse(result.stdout)["pages"].size)
      @output.delete
      recipe["inputs"]["book"]["sha256"] = Digest::SHA256.file(@source).hexdigest
      assert_empty(run_recipe(recipe).stderr)
    end

    def test_resolve_shares_bindings_warnings_and_plan_execution
      recipe = record
      recipe["inputs"]["book"]["sha256"] = "0" * 64
      recipe["parts"][0]["pages"][0] = {"source" => "source", "pages" => "all"}
      path = write("recipe.json", recipe)
      resolved = command("resolve", path, chdir: @directory)
      refute_path_exists(@output)
      plan = JSON.parse(resolved.stdout)
      assert_equal("input-changed", JSON.parse(resolved.stderr)["code"])
      mappings = write("resolve-inputs.json", {"book" => @source.to_s})
      explicit = command("resolve", "-", "--inputs", mappings, input: JSON.generate(recipe))
      rooted = command("resolve", path, "--root", @directory)
      assert_equal(resolved.stdout, explicit.stdout)
      assert_equal(resolved.stdout, rooted.stdout)
      applied = run_recipe(recipe)
      direct = compose(plan, {"book" => @source})
      assert_equal(applied.stdout, direct.stdout)
      assert_equal(@output.binread, @directory.join("direct.pdf").binread)
      assert_equal(applied.stderr, resolved.stderr)
      command("resolve", path, "--output", @output, status: 2)
      command("resolve", "-", "--inputs", "-", input: JSON.generate(recipe), status: 2)
      recipe["parts"][0]["pages"] = [{"source" => "source", "page" => 10}]
      failure = command("resolve", write("invalid.json", recipe), "--root", @directory, status: 1)
      assert_equal("invalid-request", JSON.parse(failure.stderr)["code"])
      assert_empty(failure.stdout)
    end

    def test_recipe_lookup_uses_cwd_or_root_and_preserves_pdf_suffixes
      nested = @directory.join("config")
      nested.mkpath
      path = write("config/recipe.json", record)
      command("apply", path, "--output", @output, chdir: @directory)
      @output.delete
      command("apply", path, "--output", @output, chdir: nested, status: 2)
      refute_path_exists(@output)
      command("apply", path, "--root", @directory, "--output", @output)
      @output.delete
      command("apply", "-", "--output", @output, input: JSON.generate(record), chdir: @directory)
      @output.delete
      command("apply", "-", "--root", "..", "--output", @output, input: JSON.generate(record), chdir: nested)
      @output.delete
      subfolder = @directory.join("pdfs")
      subfolder.mkpath
      %w[book book.pdf book.PDF .pdf].each do |id|
        FileUtils.cp(@source, subfolder.join(id.end_with?(".pdf", ".PDF") ? id : "#{id}.pdf"))
        recipe = record
        recipe["inputs"] = {"pdfs/#{id}" => {}}
        recipe["sources"]["source"]["input"] = "pdfs/#{id}"
        command("apply", write("config/recipe.json", recipe), "--output", @output, chdir: @directory)
        @output.delete
      end

      bindings = write("bindings.json", {"book" => "book.pdf"})
      command(
        "apply",
        path = write("recipe.json", record),
        "--inputs",
        bindings,
        "--output",
        @output,
        chdir: @directory
      )
      @output.delete
      command("apply", path, "--inputs", bindings, "--output", @output, chdir: nested, status: 2)
      bindings = write("bindings.json", {"book" => @source.to_s})
      command("apply", "-", "--inputs", bindings, "--output", @output, input: JSON.generate(record))
      @output.delete
      command("apply", path, "--inputs", bindings, "--root", @directory, "--output", @output, status: 2)
    end

    def test_filename_lookup_is_bounded_and_explicit_bindings_accept_opaque_ids
      ["/book", "../book", "folder/../book", "folder//book", "C:book", "book\\other"].each do |id|
        recipe = record
        recipe["inputs"] = {id => {}}
        recipe["sources"]["source"]["input"] = id
        failure = command("apply", write("recipe.json", recipe), "--root", @directory, "--output", @output, status: 2)
        assert_includes(failure.stderr, "--inputs")
        bindings = write("bindings.json", {id => @source.to_s})
        command("apply", write("recipe.json", recipe), "--inputs", bindings, "--output", @output)
        @output.delete
      end

      link = @directory.join("link.pdf")
      File.symlink(@source, link)
      recipe = record
      recipe["inputs"] = {"link" => {}}
      recipe["sources"]["source"]["input"] = "link"
      command("apply", write("recipe.json", recipe), "--root", @directory, "--output", @output, status: 2)
      link.delete
      @directory.join("link.pdf").mkpath
      command("apply", write("recipe.json", recipe), "--root", @directory, "--output", @output, status: 2)
      refute_path_exists(@output)
      linked = @directory.join("linked")
      File.symlink(@directory, linked)
      recipe["inputs"] = {"linked/book" => {}}
      recipe["sources"]["source"]["input"] = "linked/book"
      command("apply", write("recipe.json", recipe), "--root", @directory, "--output", @output, status: 2)
      refute_path_exists(@output)
    end

    def test_explicit_bindings_require_exact_recipe_inputs
      path = write("recipe.json", record)
      [{}, {"other" => @source.to_s}, {"book" => @source.to_s, "other" => @other.to_s}, {"book" => false}].each do |
          bindings
        |
        result = command("apply", path, "--inputs", write("bindings.json", bindings), "--output", @output, status: 1)
        assert_equal("invalid-request", JSON.parse(result.stderr)["code"])
        refute_path_exists(@output)
      end

      command("apply", path, "--inputs", write("bindings.json", {"book" => "-"}), "--output", @output, status: 2)
    end

    def test_recipe_errors_preserve_input_and_existing_output
      before = @source.binread
      @output.binwrite("existing")
      run_recipe(record, status: 2)
      assert_equal("existing", @output.binread)
      assert_equal(before, @source.binread)
      assert_empty(@directory.glob(".mainz-*"))
      @output.delete
      [
        -> (r) { r["version"] = 2 },
        -> (r) { r["extra"] = true },
        -> (r) { r["sources"]["source"]["input"] = "missing" },
        -> (r) { r["parts"][0]["pages"][0]["page"] = 1 },
        -> (r) { r["sources"]["source"]["profiles"] = [{"set" => "print", "id" => "unknown"}] },
        -> (r) { r["sources"]["source"]["overrides"] = [{"id" => "width", "value" => 3}] },
        -> (r) { r["sources"]["source"]["overrides"] = [{"id" => "missing", "value" => nil}] },
        -> (r) {
          r["sources"]["source"]["overrides"] = [
            {"id" => "width", "value" => 0.1},
            {"family" => "fixture", "key" => "guide.width", "value" => 0.2}
          ]
        },
        -> (r) {
          r["sources"]["source"]["profiles"] = [
            {"set" => "print", "id" => "fine"},
            {"family" => "fixture", "name" => "Fine"}
          ]
        },
        -> (r) { r["parts"][0]["copies"] = 1001 },
        -> (r) {
          r["parts"][0]["pages"] = Array.new(11) { {"source" => "source", "pages" => "all"} }
          r["parts"][0]["copies"] = 1000
        }
      ].each do |mutate|
        recipe = record
        mutate.call(recipe)
        result = run_recipe(recipe, status: 1)
        assert_empty(result.stdout)
        assert_equal("request", JSON.parse(result.stderr)["source"])
        assert_equal(before, @source.binread)
        refute_path_exists(@output)
      end

      path = @directory.join("plan.json")
      path.write("{\"version\":1,\"version\":1,\"inputs\":{},\"sources\":{},\"parts\":[]}")
      assert_equal("invalid-request", JSON.parse(command("apply", path, "--output", @output, status: 1).stderr)["code"])
    end

    def test_semantic_all_requires_explicit_scope
      composed = @directory.join("repeated.pdf")
      plan = {
        "version" => 1,
        "sources" => {"a" => {"input" => "book", "overrides" => {}}, "b" => {"input" => "book", "overrides" => {}}},
        "parts" => [{"pages" => [{"source" => "a", "page" => 0}, {"source" => "b", "page" => 0}]}]
      }
      compose(plan, {"book" => @source}, composed)
      recipe = record
      recipe["sources"]["source"]["profiles"] = [{"family" => "fixture", "name" => "Fine"}]
      assert_includes(run_recipe(recipe, inputs: {"book" => composed}, status: 1).stderr, "Ambiguous")
      recipe["sources"]["source"]["profiles"][0]["all"] = true
      recipe["sources"]["source"]["overrides"] = [{"family" => "fixture", "key" => "guide.width", "value" => 0.2}]
      assert_includes(run_recipe(recipe, inputs: {"book" => composed}, status: 1).stderr, "Ambiguous")
      recipe["sources"]["source"]["overrides"][0]["all"] = true
      recipe["parts"][0]["pages"] = [{"source" => "source", "pages" => "all"}]
      result = run_recipe(recipe, inputs: {"book" => composed})
      description = JSON.parse(command("describe", @output).stdout)
      widths = JSON.parse(result.stdout)["parameters"].filter_map do |output_id, original|
        description["parameters"][output_id]["parameter"]["value"] if original["parameter"].end_with?(":width")
      end

      assert_equal([0.2, 0.2], widths)
    end

    def test_saved_input_styles_are_not_implicit_recipe_assignments
      apply = write("apply.json", {"width" => 0.2})
      saved = @directory.join("saved.pdf")
      command("style", @source, "--overrides", apply, "--output", saved)
      recipe = record
      run_recipe(recipe, inputs: {"book" => saved})
      description = JSON.parse(command("describe", @output).stdout)
      assert(description["parameters"].values.none? { |entry| entry["parameter"].key?("value") })
    end

    def test_blank_only_recipes_need_no_inputs
      recipe = {
        "version" => 1,
        "inputs" => {},
        "sources" => {},
        "parts" => [{"pages" => [{"blank" => {"width" => 80, "height" => 100}}], "copies" => 3, "front" => true}]
      }
      result = run_recipe(recipe)
      assert_equal(6, JSON.parse(result.stdout)["pages"].size)
      assert_equal({}, JSON.parse(command("describe", @output).stdout)["parameters"])
    end

    def test_input_presentation_is_bounded_and_does_not_change_resolution
      recipe = record
      original = command("resolve", write("original.json", recipe), "--root", @directory).stdout
      chunk = -> (kind, data) { [data.bytesize].pack("N") + kind + data + [Zlib.crc32(kind + data)].pack("N") }
      random = Random.new(42)
      rows = Array.new(64) { "\0".b + random.bytes(64 * 3) }.join
      png = "\x89PNG\r\n\x1a\n".b +
        chunk.call("IHDR", [64, 64, 8, 2, 0, 0, 0].pack("NNC5")) +
        chunk.call("IDAT", Zlib.deflate(rows)) +
        chunk.call("IEND", "")
      cover = "data:image/png;base64," + Base64.strict_encode64(png)
      assert_operator(cover.bytesize, :>, 4096)
      recipe["inputs"]["book"].merge!("title" => "Practice", "cover" => cover, "xmp" => {"dc:creator" => "Author"})
      assert_equal(original, command("resolve", write("presented.json", recipe), "--root", @directory).stdout)
      [
        {"cover" => "data:image/svg+xml;base64,PHN2Zy8+"},
        {"cover" => cover + "!"},
        {"title" => "x" * 4097},
        {"xmp" => {"dc:creator" => []}}
      ].each_with_index do |values, index|
        invalid = Marshal.load(Marshal.dump(recipe))
        invalid["inputs"]["book"].merge!(values)
        failure = command(
          "resolve",
          write("invalid-presentation-#{index}.json", invalid),
          "--root",
          @directory,
          status: 1
        )
        assert_empty(failure.stdout)
        assert_equal("request", JSON.parse(failure.stderr)["source"])
      end
    end

    def test_publication_fast_forward_keeps_validation_authoritative
      publication = {"id" => "fixture/book", "version" => "1.9.9"}
      actual = publication.merge("version" => "1.10.0+native.2")
      input = prepare("published", "width", 0.12, publication: actual)
      recipe = record
      recipe["inputs"]["book"].merge!("publication" => publication, "sha256" => "0" * 64)
      recipe["sources"]["source"]["profiles"] = [{"family" => "fixture", "name" => "Fine"}]
      result = run_recipe(recipe, inputs: {"book" => input})
      assert_empty(result.stderr)
      description = JSON.parse(command("describe", @output).stdout)
      width = description["parameters"].values.find { |entry| entry.dig("parameter", "key") == "guide.width" }
      assert_equal(0.12, width["parameter"]["value"])
      refute(description.key?("publication"), "Composition must not inherit a producer's publication claim")
      @output.delete
      recipe["inputs"]["book"]["pageCount"] = 2
      failure = run_recipe(recipe, inputs: {"book" => input}, status: 1)
      assert_equal("/inputs/book/pageCount", JSON.parse(failure.stderr)["location"])
      refute_path_exists(@output)
      recipe["inputs"]["book"].delete("pageCount")
      recipe["sources"]["source"]["overrides"] = [{"id" => "width", "value" => 3}]
      failure = run_recipe(recipe, inputs: {"book" => input}, status: 1)
      assert_equal("/sources/source/overrides/0", JSON.parse(failure.stderr)["location"])
      refute_path_exists(@output)
    end

    def test_publication_versions_compare_numerically_and_fail_closed
      [
        ["book", "1.9.9", "book", "1.10.0", nil],
        ["book", "1.2.9", "book", "1.2.10", nil],
        ["book", "1.2.3+one", "book", "1.2.3+two", nil],
        ["book", "1.0.0", "other", "1.1.0", "input-incompatible"],
        ["book", "1.2.3", "book", "2.0.0", "input-incompatible"],
        ["book", "1.2.3", "book", "1.2.2", "input-incompatible"],
        ["book", "1.2.3", "book", "1.3.0-rc.1", "input-incompatible"],
        ["book", "0.1.0", "book", "0.1.0", "input-changed"],
        ["book", "1.2.3-rc.1", "book", "1.2.3-rc.1", "input-changed"],
        ["book", "999999999999999999999.9.0", "book", "999999999999999999999.10.0", nil]
      ].each_with_index do |(old_id, old_version, id, version, warning), index|
        input = prepare("version-#{index}", "width", 0.1, publication: {"id" => id, "version" => version})
        recipe = record
        recipe["inputs"]["book"].merge!(
          "publication" => {"id" => old_id, "version" => old_version},
          "sha256" => "0" * 64
        )
        result = run_recipe(recipe, inputs: {"book" => input})
        if warning
          assert_equal(warning, JSON.parse(result.stderr)["code"])
        else
          assert_empty(result.stderr)
        end

        @output.delete
      end

      recipe = record
      recipe["inputs"]["book"]["publication"] = {"id" => "book", "version" => "1.0.0"}
      assert_equal("input-incompatible", JSON.parse(run_recipe(recipe).stderr)["code"])
    end

    def test_publication_metadata_is_validated_and_preserved_by_style
      publication = {"id" => "fixture/book", "version" => "1.2.3-beta.2+build.01"}
      input = prepare("published", "width", 0.1, publication: publication)
      assert_equal(publication, JSON.parse(command("describe", input).stdout)["publication"])
      styled = @directory.join("styled.pdf")
      command("style", input, "--profile", "fine", "--output", styled)
      assert_equal(publication, JSON.parse(command("describe", styled).stdout)["publication"])
      restored = @directory.join("restored.pdf")
      command("reset", styled, "--output", restored)
      assert_equal(publication, JSON.parse(command("describe", restored).stdout)["publication"])
      declaration = JSON.parse(@directory.join("published.json").read)
      ["1", "v1.2.3", "01.2.3", "1.2.3.4", "1.2.3-01", "1.2.3+", "1.2.3-", "1.2.3+bad..id", false].each do |version|
        declaration["publication"]["version"] = version
        failure = command(
          "imprint",
          @directory.join("published.svg"),
          "--declaration",
          write("invalid.json", declaration),
          "--output",
          @output,
          status: 1
        )
        assert_equal("/publication", JSON.parse(failure.stderr)["location"])
        refute_path_exists(@output)
      end
    end

    private

    def prepare(name, id, width, publication: nil)
      svg = @directory.join("#{name}.svg")
      svg.write(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"><g id=\"Ink\" fill=\"none\" stroke=\"black\"><rect x=\"20\" y=\"20\" width=\"40\" height=\"40\"/></g></svg>"
      )
      declaration = {
        "targets" => {"ink" => {"selectors" => ["#Ink"]}},
        "parameters" => {
          id => {
            "family" => "fixture",
            "key" => "guide.width",
            "schema" => {"type" => "number", "minimum" => 0, "maximum" => 2},
            "binding" => {"targets" => ["ink"], "property" => "stroke-width"}
          },
          "color" => {
            "schema" => {"type" => "string"},
            "binding" => {"targets" => ["ink"], "property" => "stroke-color"}
          }
        },
        "profileSets" => [
          {
            "id" => "print",
            "family" => "fixture",
            "name" => "Print",
            "parameters" => [id, "color"],
            "profiles" => [
              {"id" => "original", "name" => "Original", "overrides" => {}},
              {"id" => "fine", "name" => "Fine", "overrides" => {id => width, "color" => "#112233"}}
            ]
          }
        ]
      }
      declaration["publication"] = publication if publication
      pdf = @directory.join("#{name}.pdf")
      command("imprint", svg, "--declaration", write("#{name}.json", declaration), "--output", pdf)
      pdf
    end

    def record
      {
        "version" => 1,
        "inputs" => {"book" => {}},
        "sources" => {"source" => {"input" => "book"}},
        "parts" => [{"pages" => [{"source" => "source", "page" => 0}]}]
      }
    end

    def write(name, value)
      @directory.join(name).tap { it.write(JSON.generate(value)) }
    end

    def run_recipe(recipe, status: 0, inputs: nil)
      paths = inputs || {"book" => @source, "other" => @other}
      bindings = recipe["inputs"].keys.to_h { |id| [id, paths.fetch(id).to_s] }
      command(
        "apply",
        write("recipe.json", recipe),
        "--inputs",
        write("recipe-inputs.json", bindings),
        "--output",
        @output,
        status: status
      )
    end

    def compose(plan, inputs, output = @directory.join("direct.pdf"))
      command(
        "compose",
        write("direct.json", plan),
        "--inputs",
        write("inputs.json", inputs.transform_values(&:to_s)),
        "--output",
        output
      )
    end

    def command(*arguments, status: 0, input: nil, chdir: ROOT)
      result = Mainz.capture(@cli, *arguments, input: input, chdir: chdir)
      assert_equal(status, result.status.exitstatus, "#{arguments.inspect}: #{result.stdout}#{result.stderr}")
      result
    end
  end
end
