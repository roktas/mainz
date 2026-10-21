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
      [["--version"], ["describe", @prepared], ["verify", @prepared], ["verify", @source]].each do |arguments|
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

    private

    def operations
      [["apply", @prepared, ["--request", @request]], ["produce", @source, ["--declaration", @declaration]]]
    end

    def command(*arguments, status: 0, input: nil)
      result = Mainz.capture(@cli, *arguments, input: input)
      assert_equal(status, result.status.exitstatus, "#{arguments.inspect}: #{result.stdout}#{result.stderr}")
      result
    end
  end
end
