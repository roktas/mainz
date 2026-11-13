# frozen_string_literal: true

require "minitest/autorun"
require "base64"
require "zlib"
require "timeout"

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
      recipe["inputs"]["other"] = {"sha256" => Digest::SHA256.file(@other).hexdigest}
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

    def test_all_pages_requires_review_when_the_reference_changes
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
      assert_equal("review-required", JSON.parse(run_recipe(recipe, status: 1).stderr)["code"])
      run_recipe(recipe, force: true)
      assert_equal(8, JSON.parse(command("describe", @output).stdout)["pageCount"])
      @output.delete
      recipe["inputs"]["book"]["pageCount"] = 1
      failure = run_recipe(recipe, status: 1)
      assert_equal("review-required", JSON.parse(failure.stderr)["code"])
      refute_path_exists(@output)
    end

    def test_resolve_shares_bindings_and_plan_execution
      recipe = record
      recipe["parts"][0]["pages"][0] = {"source" => "source", "pages" => "all"}
      path = write("recipe.json", recipe)
      resolved = command("resolve", path, chdir: @directory)
      refute_path_exists(@output)
      plan = JSON.parse(resolved.stdout)
      assert_empty(resolved.stderr)
      mappings = write("resolve-inputs.json", {"book" => @source.to_s})
      explicit = command("resolve", "-", "--inputs", mappings, input: JSON.generate(recipe))
      rooted = command("resolve", path, "--root", @directory)
      assert_equal(resolved.stdout, explicit.stdout)
      assert_equal(resolved.stdout, rooted.stdout)
      applied = run_recipe(recipe)
      direct = compose(plan, {"book" => @source})
      assert_equal(applied.stdout, direct.stdout)
      assert_equal(@output.binread, @directory.join("direct.pdf").binread)
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
        recipe["inputs"] = {"pdfs/#{id}" => {"sha256" => Digest::SHA256.file(@source).hexdigest}}
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
      @directory.join("folder").mkpath
      ["..pdf", "...pdf", "folder/.pdf"].each { |name| FileUtils.cp(@source, @directory.join(name)) }
      [".", "..", "folder/", "/book", "../book", "folder/../book", "folder//book", "C:book", "book\\other"].each do |id|
        recipe = record
        recipe["inputs"] = {id => {"sha256" => Digest::SHA256.file(@source).hexdigest}}
        recipe["sources"]["source"]["input"] = id
        path = write("recipe.json", recipe)
        bindings = write("bindings.json", {id => @source.to_s})
        %w[apply resolve].each do |operation|
          options = operation == "apply" ? ["--output", @output] : []
          failure = command(operation, path, "--root", @directory, *options, status: 2)
          assert_includes(failure.stderr, "--inputs")
          assert_empty(failure.stdout)
          command(operation, path, "--inputs", bindings, *options)
          @output.delete if @output.exist?
        end
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

    def test_cancellation_during_recipe_binding_preserves_files
      source = @source.binread
      %w[apply resolve].each do |operation|
        %w[INT TERM].each do |signal|
          reader, writer = IO.pipe
          path = write("recipe.json", record)
          bindings = write("bindings.json", {"book" => "/dev/fd/3"})
          @output.binwrite("protected")
          options = operation == "apply" ? ["--output", @output.to_s] : []
          Open3
            .popen3(@cli, operation, path.to_s, "--inputs", bindings.to_s, *options, 3 => reader) do |
                stdin,
                stdout,
                stderr,
                process
              |
              begin
                Timeout.timeout(10) do
                  stdin.close
                  reader.close
                  writer.write(" " * (2 * 1024 * 1024))
                  writer.flush
                  Process.kill(signal, process.pid)
                  writer.close
                  assert_empty(stdout.read)
                  assert_includes(stderr.read, "Operation cancelled")
                  assert_equal(130, process.value.exitstatus)
                end

              ensure
                writer.close unless writer.closed?
                reader.close unless reader.closed?
                if process.alive?
                  Process.kill("KILL", process.pid)
                  process.join
                end
              end
            end

          assert_equal("protected", @output.binread)
          assert_equal(source, @source.binread)
          assert_empty(@directory.glob(".mainz-*"))
        end
      end
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
      result = run_recipe(recipe, inputs: {"book" => composed}, force: true)
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
      run_recipe(recipe, inputs: {"book" => saved}, force: true)
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

    def test_publication_compat_is_a_veto_and_does_not_replace_validation
      publication = {"id" => "fixture/book", "compat" => 1}
      input = prepare("published", "width", 0.12, publication: publication)
      recipe = record
      recipe["inputs"]["book"].merge!("publication" => publication, "sha256" => "0" * 64)
      recipe["sources"]["source"]["profiles"] = [{"family" => "fixture", "name" => "Fine"}]
      assert_equal(
        "review-required",
        JSON.parse(run_recipe(recipe, inputs: {"book" => input}, status: 1).stderr)["code"]
      )
      run_recipe(recipe, inputs: {"book" => input}, force: true)
      description = JSON.parse(command("describe", @output).stdout)
      width = description["parameters"].values.find { |entry| entry.dig("parameter", "key") == "guide.width" }
      assert_equal(0.12, width["parameter"]["value"])
      assert_equal(publication, description["publication"], "Whole-Input styling retains the publication claim")
      @output.delete
      recipe["sources"]["source"]["overrides"] = [{"id" => "width", "value" => 3}]
      failure = run_recipe(recipe, inputs: {"book" => input}, force: true, status: 1)
      assert_equal("/sources/source/overrides/0", JSON.parse(failure.stderr)["location"])
      refute_path_exists(@output)
      recipe["sources"]["source"].delete("overrides")
      [{"id" => "fixture/book", "compat" => 2}, {"id" => "other/book", "compat" => 1}].each do |before|
        recipe["inputs"]["book"]["publication"] = before
        failure = run_recipe(recipe, inputs: {"book" => input}, force: true, status: 1)
        assert_equal("input-incompatible", JSON.parse(failure.stderr)["code"])
        refute_path_exists(@output)
      end
    end

    def test_publication_metadata_is_validated_and_preserved_by_style
      publication = {"id" => "fixture/book", "compat" => 9007199254740991}
      input = prepare("published", "width", 0.1, publication: publication)
      assert_equal(publication, JSON.parse(command("describe", input).stdout)["publication"])
      styled = @directory.join("styled.pdf")
      command("style", input, "--profile", "fine", "--output", styled)
      assert_equal(publication, JSON.parse(command("describe", styled).stdout)["publication"])
      restored = @directory.join("restored.pdf")
      command("reset", styled, "--output", restored)
      assert_equal(publication, JSON.parse(command("describe", restored).stdout)["publication"])
      declaration = JSON.parse(@directory.join("published.json").read)
      [0, -1, 1.5, 9007199254740992, "1", false, nil].each do |compat|
        declaration["publication"]["compat"] = compat
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

    def test_shared_input_cases_enforce_policy_and_emit_jsonl
      fixtures = @directory.join("checks")
      Mainz.run(ROOT.join("lib/test/fixtures/build.rb"), @cli, fixtures)
      cases = JSON.parse(fixtures.join("cases.json").read)
      reference = JSON.parse(fixtures.join("ready.json").read).dig("inputs", "book")
      assert_equal(3, reference["pageCount"])
      assert_equal(
        Digest::SHA256.hexdigest("mainz-page-names-v1\n5:Cover;6:Guides;8:Practice;"),
        reference["pageNamesSha256"]
      )
      cases.each do |entry|
        path = fixtures.join("#{entry.fetch("id")}.json")
        input = fixtures.join(entry.fetch("pdf"))
        before = [path.binread, input.binread]
        bindings = write("bindings.json", {"book" => input.to_s})
        [false, true].each do |force|
          rejected = entry.fetch("state") == "error" || (entry.fetch("state") == "review" && !force)
          %w[apply resolve align].each do |operation|
            output = @directory.join("#{entry.fetch("id")}-#{force}-#{operation}")
            options = operation == "resolve" ? [] : ["--output", output]
            result = command(
              operation,
              path,
              "--inputs",
              bindings,
              "--jsonl",
              *(force ? ["--force"] : []),
              *options,
              status: rejected ? 1 : 0
            )
            assert_empty(result.stderr)
            events = result.stdout.lines.map { JSON.parse(it) }
            assert_equal("input", events.first["type"])
            assert_equal(entry.fetch("state"), events.first["state"], entry.fetch("id"))
            assert_equal(rejected ? "error" : "result", events.last["type"])
            if rejected
              refute_path_exists(output)
            elsif operation == "align"
              aligned = JSON.parse(output.read)
              original = JSON.parse(path.read)
              assert_equal(original["parts"], aligned["parts"])
              assert_equal(original["sources"], aligned["sources"])
              assert_equal(Digest::SHA256.file(input).hexdigest, aligned.dig("inputs", "book", "sha256"))
              replay = command("resolve", output, "--inputs", bindings, "--jsonl")
              assert_equal("ready", JSON.parse(replay.stdout.lines.first)["state"])
            end
          end
        end

        assert_equal(before, [path.binread, input.binread])
      end

      bindings = write("bindings.json", {"book" => fixtures.join("update.pdf").to_s})
      quiet = command("resolve", fixtures.join("update.json"), "--inputs", bindings)
      assert_empty(quiet.stderr)
      verbose = command("resolve", fixtures.join("update.json"), "--inputs", bindings, "--verbose")
      assert_equal(quiet.stdout, verbose.stdout)
      assert_equal("update", JSON.parse(verbose.stderr)["state"])
      bindings = write("bindings.json", {"book" => fixtures.join("review.pdf").to_s})
      forced = command("resolve", fixtures.join("review.json"), "--inputs", bindings, "--force")
      assert_equal("review", JSON.parse(forced.stderr)["state"])
      mixed = JSON.parse(fixtures.join("ready.json").read)
      mixed["inputs"]["other"] = mixed["inputs"]["book"].dup
      mixed["sources"]["other"] = mixed["sources"]["source"].merge("input" => "other")
      mixed["parts"][0]["pages"] << {"source" => "other", "pages" => "all"}
      path = write("mixed.json", mixed)
      %w[review compat].each do |candidate|
        bindings = write(
          "mixed-inputs.json",
          {"book" => fixtures.join("update.pdf").to_s, "other" => fixtures.join("#{candidate}.pdf").to_s}
        )
        result = command("resolve", path, "--inputs", bindings, "--jsonl", status: 1)
        events = result.stdout.lines.map { JSON.parse(it) }
        assert_equal(["update", candidate == "review" ? "review" : "error"], events.take(2).map { it["state"] })
        assert_equal(candidate == "review" ? "review" : "error", events.last.dig("details", "state"))
      end

      command("resolve", fixtures.join("review.json"), "--inputs", bindings, "--force", "--force", status: 2)
      failure = command("resolve", write("bad.json", {"version" => 999}), "--jsonl", status: 1)
      assert_equal("error", JSON.parse(failure.stdout)["type"])
      assert_empty(failure.stderr)
      failure = command("resolve", @directory.join("bad.json"), "--root", "--jsonl", status: 1)
      assert_empty(failure.stdout)
      assert_equal("invalid-request", JSON.parse(failure.stderr)["code"])
      invalid = JSON.parse(fixtures.join("review.json").read)
      invalid["metadata"] = {"coverPage" => 9}
      bindings = write("bindings.json", {"book" => fixtures.join("review.pdf").to_s})
      [false, true].each do |force|
        result = command(
          "resolve",
          write("invalid-output.json", invalid),
          "--inputs",
          bindings,
          *(force ? ["--force"] : []),
          status: 1
        )
        assert_equal("invalid-request", JSON.parse(result.stderr)["code"])
        assert_equal("/metadata", JSON.parse(result.stderr)["location"])
      end
    end

    def test_plan_byte_limit_precedes_review_acceptance
      recipe = record
      recipe["inputs"]["book"]["sha256"] = "0" * 64
      source = "s" * 160
      recipe["sources"] = {source => {"input" => "book"}}
      recipe["parts"] = [{"pages" => Array.new(10000) { {"source" => source, "page" => 0} }}]
      path = write("large.json", recipe)
      [false, true].each do |force|
        result = command("resolve", path, "--root", @directory, *(force ? ["--force"] : []), status: 1)
        assert_equal("limit-exceeded", JSON.parse(result.stderr)["code"])
        assert_empty(result.stdout)
      end
    end

    def test_alignment_preserves_intent_and_never_overwrites_files
      recipe = record
      recipe["inputs"]["book"]["sha256"] = "0" * 64
      recipe["sources"]["source"].merge!(
        "profiles" => [{"family" => "fixture", "name" => "Fine"}],
        "overrides" => [{"family" => "fixture", "key" => "guide.width", "value" => nil}]
      )
      recipe["parts"] = [{"pages" => [{"source" => "source", "pages" => "all"}], "copies" => 2, "front" => true}]
      recipe["metadata"] = {"title" => "Practice", "coverPage" => 1}
      original = write("recipe.json", recipe)
      before = original.binread
      target = @directory.join("aligned.json")
      command("align", original, "--root", @directory, "--output", target, "--force")
      aligned = JSON.parse(target.read)
      assert_equal(recipe.reject { |key, _| key == "inputs" }, aligned.reject { |key, _| key == "inputs" })
      assert_equal(before, original.binread)
      saved = target.binread
      command("align", original, "--root", @directory, "--output", target, "--force", status: 2)
      command("align", original, "--root", @directory, "--output", original, "--force", status: 2)
      assert_equal(saved, target.binread)
      assert_equal(before, original.binread)
      assert_empty(command("resolve", target, "--root", @directory).stderr)
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
        "inputs" => {"book" => {"sha256" => Digest::SHA256.file(@source).hexdigest}},
        "sources" => {"source" => {"input" => "book"}},
        "parts" => [{"pages" => [{"source" => "source", "page" => 0}]}]
      }
    end

    def write(name, value)
      @directory.join(name).tap { it.write(JSON.generate(value)) }
    end

    def run_recipe(recipe, status: 0, inputs: nil, force: false)
      paths = inputs || {"book" => @source, "other" => @other}
      bindings = recipe["inputs"].keys.to_h { |id| [id, paths.fetch(id).to_s] }
      command(
        "apply",
        write("recipe.json", recipe),
        "--inputs",
        write("recipe-inputs.json", bindings),
        "--output",
        @output,
        *(force ? ["--force"] : []),
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
