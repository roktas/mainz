# frozen_string_literal: true

require "minitest/autorun"
require "timeout"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::ROOT)

module Mainz
  class CLITest < Minitest::Test
    def setup
      @directory = Pathname(Dir.mktmpdir("cli-", Mainz.workspace("tmp/test/cli").to_s))
      @cli = File.expand_path(ENV.fetch("MAINZ_CLI"))
      @source = @directory.join("source.svg")
      @source.write(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"><g id=\"Ink\" fill=\"none\" stroke=\"black\"><rect x=\"20\" y=\"20\" width=\"40\" height=\"40\"/></g></svg>"
      )
      @declaration = @directory.join("declaration.json")
      @declaration.write(
        JSON.generate(
          targets: {ink: {selectors: ["#Ink"]}},
          parameters: {
            display: {schema: {type: "string", enum: %w[inline none]}, binding: {targets: ["ink"], property: "display"}}
          }
        )
      )
      @prepared = @directory.join("prepared.pdf")
      assert_equal(
        {"ok" => true},
        JSON.parse(command("produce", @source, "--declaration", @declaration, "--output", @prepared).stdout)
      )
      @request = @directory.join("request.json")
      @request.write("{}")
      @protected = @directory.join("protected.pdf")
      @protected.binwrite("protected")
    end

    def teardown
      FileUtils.remove_entry(@directory)
    end

    def test_version_and_verification_return_structured_results
      version = JSON.parse(command("--version").stdout)
      assert_equal(ROOT.join("VERSION").read.strip, version["version"])
      assert_equal(1, version["contract"])
      assert(JSON.parse(command("verify", @prepared).stdout)["valid"])
    end

    def test_stdout_failures_return_host_errors
      [["--version"], ["describe", @prepared], ["profiles", @prepared], ["verify", @prepared], ["verify", @source]].each do |
          arguments
        |
        IO.pipe do |reader, writer|
          reader.close
          diagnostic = @directory.join("stdout-error.txt")
          pid = Process.spawn(@cli, *arguments.map(&:to_s), out: writer, err: diagnostic.to_s)
          _, status = Process.wait2(pid)
          assert_equal(2, status.exitstatus, arguments.inspect)
          assert_includes(diagnostic.read, "Cannot write stdout.")
        end
      end
    end

    def test_usage_errors_write_only_stderr
      [
        [],
        ["unknown", @prepared],
        ["apply", @prepared],
        ["describe", @prepared, "--extra", "x"],
        ["describe", @prepared, "--extra"],
        ["produce", @source, "--declaration", @declaration, "--output", "-"],
        ["produce", "-", "--declaration", "-", "--output", @prepared],
        ["describe", @prepared, "--extra", "x", "--extra", "y"]
      ].each do |arguments|
        result = command(*arguments, status: 2)
        refute_empty(result.stderr)
        assert_empty(result.stdout)
      end
    end

    def test_invalid_dimensions_are_argument_errors
      %w[--width --height --dpi].product([*%w[0 -1 nan inf 1e309 12px], ""]).each do |option, value|
        failure = command(
          "produce",
          @source,
          "--declaration",
          @declaration,
          option,
          value,
          "--output",
          @prepared,
          status: 2
        )
        assert_includes(failure.stderr, "Invalid #{option}")
        assert_empty(failure.stdout)
      end
    end

    def test_invalid_input_bindings_report_request_locations
      job = @directory.join("job.json")
      job.write(JSON.generate(version: 1, sources: {}, parts: [{pages: [{blank: {width: 100, height: 100}}]}]))
      bindings = @directory.join("inputs.json")
      output = @directory.join("composed.pdf")
      [[[], ""], [{"/~book" => false}, "/~1~0book"], [{"bad\nid" => @prepared.to_s}, "/bad\nid"]].each do |
          value,
          location
        |
        bindings.write(JSON.generate(value))
        result = command("compose", job, "--inputs", bindings, "--output", output, status: 1)
        error = JSON.parse(result.stderr)
        assert_equal("invalid-request", error["code"])
        assert_equal("request", error["source"])
        assert_equal(location, error["location"])
        assert_empty(result.stdout)
        refute_path_exists(output)
      end
    end

    def test_input_paths_cannot_contain_null_bytes
      job = @directory.join("job.json")
      job.write(
        JSON.generate(
          version: 1,
          sources: {source: {input: "book", overrides: {}}},
          parts: [{pages: [{source: "source", page: 0}]}]
        )
      )
      bindings = @directory.join("inputs.json")
      bindings.write(JSON.generate("book" => "#{@prepared}\0missing"))
      output = @directory.join("null-path.pdf")
      failure = command("compose", job, "--inputs", bindings, "--output", output, status: 2)
      assert_includes(failure.stderr, "null byte")
      assert_empty(failure.stdout)
      refute_path_exists(output)
    end

    def test_output_errors_preserve_input_and_existing_files
      operations.each do |command, input, options|
        [@protected, input, @directory.join("missing-dir/result.pdf")].each do |destination|
          before = input.binread
          command(command, input, *options, "--output", destination, status: 2)
          assert_equal(before, input.binread)
          assert_equal("protected", @protected.binread)
          assert_empty(@directory.glob(".mainz-*"))
        end
      end
    end

    def test_output_retries_temporary_cleanup_after_install
      shim = @directory.join("unlink.c")
      shim.write(
        <<~C
          #define _GNU_SOURCE
          #include <dlfcn.h>
          #include <errno.h>
          #include <string.h>
          #include <unistd.h>

          int unlink(const char *path)
          {
            static int failed;
            if (!failed && strstr(path, "/.mainz-")) {
                failed = 1;
                errno = EACCES;
                return -1;
            }
            int (*original)(const char *) = dlsym(RTLD_NEXT, "unlink");
            return original(path);
          }
        C
      )
      library = @directory.join("unlink.so")
      darwin = RUBY_PLATFORM.include?("darwin")
      Mainz.run("cc", darwin ? "-dynamiclib" : "-shared", "-fPIC", shim, "-o", library, *(darwin ? [] : ["-ldl"]))
      environment = darwin ? {"DYLD_INSERT_LIBRARIES" => library.to_s, "DYLD_FORCE_FLAT_NAMESPACE" => "1"} : {
        "LD_PRELOAD" => library.to_s
      }
      output = @directory.join("installed.pdf")
      stdout, stderr, status = Open3.capture3(
        environment,
        @cli,
        "reset",
        @prepared.to_s,
        "--output",
        output.to_s
      )
      assert_equal(0, status.exitstatus, stderr)
      assert_equal({"ok" => true}, JSON.parse(stdout))
      assert_empty(stderr)
      assert_equal(@prepared.binread, output.binread)
      assert_empty(@directory.glob(".mainz-*"))
    end

    def test_interruptions_preserve_existing_output
      operations.each do |command, _input, options|
        %w[INT TERM].each do |signal|
          Open3
            .popen3(@cli, command, "-", *options.map(&:to_s), "--output", @protected.to_s) do |
                stdin,
                stdout,
                stderr,
                process
              |
              begin
                Timeout.timeout(10) do
                  stdin.write(" " * (2 * 1024 * 1024))
                  stdin.flush
                  Process.kill(signal, process.pid)
                  stdin.close
                  assert_empty(stdout.read)
                  assert_includes(stderr.read, "Operation cancelled")
                  assert_equal(130, process.value.exitstatus)
                end

                assert_equal("protected", @protected.binread)
                assert_empty(@directory.glob(".mainz-*"))
              ensure
                if process.alive?
                  Process.kill("KILL", process.pid)
                  process.join
                end
              end
            end
        end
      end
    end

    def test_stdin_matches_file_input_and_preserves_output
      destination = @directory.join("stdin.pdf")
      command("produce", "-", "--declaration", @declaration, "--output", destination, input: @source.binread)
      assert_equal(command("describe", @prepared).stdout, command("describe", destination).stdout)
      command("apply", "-", "--request", @request, "--output", @protected, input: @prepared.binread, status: 2)
      assert_equal("protected", @protected.binread)
    end

    def test_invalid_pdf_reports_syntax_failure
      invalid = @directory.join("invalid.pdf")
      invalid.binwrite("invalid")
      failure = command("verify", invalid, status: 1)
      refute(JSON.parse(failure.stdout)["valid"])
      assert_equal("pdf-syntax", JSON.parse(failure.stderr)["code"])
    end

    def test_profiles_list_authored_sets_without_changing_input
      prepared, sets = prepare_profiles
      before = prepared.binread
      assert_equal(sets, JSON.parse(command("profiles", prepared).stdout))
      assert_equal(sets, JSON.parse(command("profiles", "-", input: before).stdout))
      assert_equal(before, prepared.binread)
      assert_equal([], JSON.parse(command("profiles", @prepared).stdout))
      ordinary = @directory.join("ordinary.pdf")
      document = HexaPDF::Document.new
      document.pages.add
      document.write(ordinary.to_s)
      assert_equal([], JSON.parse(command("profiles", ordinary).stdout))
      output = @directory.join("ordinary-styled.pdf")
      failure = command("apply", ordinary, "--profile", "inkjet", "--output", output, status: 1)
      assert_equal("missing-contract", JSON.parse(failure.stderr)["code"])
      refute_path_exists(output)
    end

    def test_profiles_replace_their_scope_and_restore_appearance
      prepared, sets = prepare_profiles
      original = prepared.binread
      description = JSON.parse(command("describe", prepared).stdout)
      assert_equal({"kind" => "mixed"}, description["parameters"]["opacity"]["baseline"])
      paths = %w[hidden bold inkjet repeated original restored].to_h { [it, @directory.join("#{it}.pdf")] }
      command("apply", prepared, "--profile", "off", "--output", paths["hidden"])
      command("apply", paths["hidden"], "--profile", "bold", "--output", paths["bold"])
      command("apply", paths["bold"], "--profile", "inkjet", "--output", paths["inkjet"])
      parameters = JSON.parse(command("describe", paths["inkjet"]).stdout).fetch("parameters")
      assert_equal(0.4, parameters["opacity"]["parameter"]["value"])
      refute(parameters["width"]["parameter"].key?("value"))
      assert_equal("none", parameters["display"]["parameter"]["value"])
      command("apply", paths["inkjet"], "--profile", "inkjet", "--output", paths["repeated"])
      assert_equal(paths["inkjet"].binread, paths["repeated"].binread)
      command("apply", paths["inkjet"], "--set", "print", "--profile", "generic", "--output", paths["original"])
      parameters = JSON.parse(command("describe", paths["original"]).stdout).fetch("parameters")
      refute(parameters["opacity"]["parameter"].key?("value"))
      refute(parameters["width"]["parameter"].key?("value"))
      assert_equal("none", parameters["display"]["parameter"]["value"])
      command("apply", paths["original"], "--set", "view", "--profile", "generic", "--output", paths["restored"])
      paths.each_value do |path|
        assert(JSON.parse(command("verify", path).stdout)["valid"])
        assert_equal(sets, JSON.parse(command("profiles", path).stdout))
        result = Mainz.capture("qpdf", "--check", path)
        assert(result.status.success?, result.stderr)
        assert_equal(Mainz::Preservation.read(prepared), Mainz::Preservation.read(path))
      end

      [150, 300].each do |dpi|
        rasters = [prepared, paths["restored"]].map do |path|
          prefix = path.sub_ext("-#{dpi}")
          result = Mainz.capture("pdftoppm", "-singlefile", "-r", dpi, "-png", path, prefix)
          assert(result.status.success?, result.stderr)
          Pathname("#{prefix}.png").binread
        end

        assert_equal(rasters.first, rasters.last, "Reset appearance differs at #{dpi} DPI")
      end

      assert_equal(original, prepared.binread)
    end

    def test_profile_selection_errors_preserve_files
      prepared, = prepare_profiles
      before = prepared.binread
      [
        ["--profile", "generic"],
        ["--profile", "missing"],
        ["--profile", "Inkjet"],
        ["--set", "missing", "--profile", "inkjet"],
        ["--set", "view", "--profile", "inkjet"]
      ].each do |options|
        [@directory.join("failed.pdf"), @protected].each do |output|
          failure = command("apply", prepared, *options, "--output", output, status: 2)
          assert_includes(failure.stderr, "print")
          assert_includes(failure.stderr, "view")
          assert_includes(failure.stderr, "inkjet")
          assert_includes(failure.stderr, "--set") if options == ["--profile", "generic"]
          assert_empty(failure.stdout)
          refute_path_exists(output) unless output == @protected
          assert_equal("protected", @protected.binread)
          assert_equal(before, prepared.binread)
          assert_empty(@directory.glob(".mainz-*"))
        end
      end

      [
        ["--profile", "inkjet", "--request", @request],
        ["--set", "print", "--request", @request],
        ["--set", "print"]
      ].each do |options|
        failure = command("apply", prepared, *options, "--output", @protected, status: 2)
        assert_empty(failure.stdout)
        assert_equal("protected", @protected.binread)
      end
    end

    def test_profile_ids_remain_opaque_with_stdin
      [["print:/ ü", "ink:jet/ü"], ["-", "-"]].each do |set_id, profile_id|
        prepared, = prepare_profiles(set_id:, profile_id:)
        output = prepared.sub_ext("-styled.pdf")
        command("apply", "-", "--set", set_id, "--profile", profile_id, "--output", output, input: prepared.binread)
        description = JSON.parse(command("describe", output).stdout)
        assert_equal(0.4, description["parameters"]["opacity"]["parameter"]["value"])
        assert_equal(set_id, description["profileSets"][0]["id"])
        assert_equal(profile_id, description["profileSets"][0]["profiles"][1]["id"])
      end
    end

    def test_profiles_reject_invalid_embedded_contracts
      prepared, = prepare_profiles
      invalid = @directory.join("invalid-contract.pdf")
      document = HexaPDF::Document.open(prepared)
      attachment = document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("mainz.json")[:EF][:F]
      manifest = JSON.parse(attachment.stream)
      manifest["profileSets"][0]["profiles"][0]["overrides"] = {"opacity" => 0.5}
      attachment.stream = JSON.generate(manifest)
      document.write(invalid.to_s)
      [["profiles", invalid], ["apply", invalid, "--profile", "inkjet", "--output", @protected]].each do |arguments|
        failure = command(*arguments, status: 1)
        assert_empty(failure.stdout)
        assert_equal("invalid-contract", JSON.parse(failure.stderr)["code"])
      end

      assert_equal("protected", @protected.binread)
    end

    private

    def prepare_profiles(set_id: "print", profile_id: "inkjet")
      directory = Pathname(Dir.mktmpdir("profiles-", @directory.to_s))
      source = directory.join("source.svg")
      source.write(
        <<~SVG
          <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
            <g id="Ink" fill="none" stroke="black" stroke-opacity="0.7"><rect x="20" y="20" width="20" height="20"/></g>
            <g id="Other" fill="none" stroke="black" stroke-opacity="0.9"><rect x="60" y="60" width="20" height="20"/></g>
          </svg>
        SVG
      )
      sets = [
        {
          id: set_id,
          name: "Printer",
          description: "Practice strokes",
          parameters: %w[opacity width],
          profiles: [
            {id: "generic", name: "Generic", overrides: {}},
            {
              id: profile_id,
              name: "Inkjet",
              description: "Pale strokes",
              details: "Uses less ink.\n\nSome printers show visible dots.",
              overrides: {opacity: 0.4}
            },
            {id: "bold", name: "Bold", overrides: {opacity: 0.8, width: 0.4}}
          ]
        },
        {
          id: "view",
          name: "Visibility",
          parameters: ["display"],
          profiles: [
            {id: "generic", name: "Original", overrides: {}},
            {id: "off", name: "Hidden", overrides: {display: "none"}}
          ]
        }
      ]
      declaration = directory.join("declaration.json")
      declaration.write(
        JSON.generate(
          targets: {ink: {selectors: ["#Ink"]}, other: {selectors: ["#Other"]}},
          parameters: {
            display: {schema: {type: "string", enum: %w[inline none]}, binding: {targets: ["ink"], property: "display"}},
            opacity: {
              schema: {type: "number", minimum: 0, maximum: 1},
              binding: {targets: %w[ink other], property: "stroke-opacity"}
            },
            width: {
              schema: {type: "number", exclusiveMinimum: 0, maximum: 0.4},
              binding: {targets: %w[ink other], property: "stroke-width"}
            }
          },
          profileSets: sets
        )
      )
      prepared = directory.join("prepared.pdf")
      command("produce", source, "--declaration", declaration, "--output", prepared)
      [prepared, JSON.parse(JSON.generate(sets))]
    end

    def operations
      profiled, = prepare_profiles
      [
        ["apply", @prepared, ["--request", @request]],
        ["apply", profiled, ["--profile", "inkjet"]],
        ["produce", @source, ["--declaration", @declaration]]
      ]
    end

    def command(*arguments, status: 0, input: nil)
      result = Mainz.capture(@cli, *arguments, input: input)
      assert_equal(status, result.status.exitstatus, "#{arguments.inspect}: #{result.stdout}#{result.stderr}")
      result
    end
  end
end
