# frozen_string_literal: true

require "minitest/autorun"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::ROOT)

module Mainz
  class ParityTest < Minitest::Test
    def test_wasm_matches_native_state_content_and_appearance
      @directory = Mainz.workspace("tmp/test/lib")
      native = File.expand_path(ENV.fetch("MAINZ_CLI"))
      wasm = File.expand_path(ENV.fetch("MAINZ_WASM", ROOT.join(".local/var/cpp/build/wasm/processor.mjs").to_s))
      file("description.json").binwrite(command(native, "describe", file("prepared.pdf")))
      file("composition-description.json").binwrite(command(native, "describe", file("composed.pdf")))
      command(ROOT.join("lib/test/wasm.mjs"), wasm, file("prepared.pdf"), file("description.json"), file("wasm.pdf"))
      command("qpdf", "--check", file("wasm.pdf"))
      assert_equal(contents(file("edited.pdf")), contents(file("wasm.pdf")))
      %w[pristine ordinary reverse].each do |name|
        command("qpdf", "--check", file("wasm-extracted-#{name}.pdf"))
        assert_equal(contents(file("extracted-#{name}.pdf")), contents(file("wasm-extracted-#{name}.pdf")))
      end

      %w[ordinary-reverse composed composed-reset shared-edited shared-chained fixed-visibility-edited].each do |name|
        assert_equal(contents(file("#{name}.pdf")), contents(file("wasm-#{name}.pdf")), name)
      end

      %w[fill-only fill-mixed].each do |name|
        %w[extracted composed].each do |operation|
          [0, 1].each do |index|
            path = "#{name}-#{operation}-#{index}.pdf"
            assert_equal(contents(file(path)), contents(file("wasm-#{path}")), path)
          end
        end
      end

      command("qpdf", "--check", file("wasm-composed.pdf"))
      command("qpdf", "--check", file("wasm-styled.pdf"))
      assert_equal(Preservation.read(file("styled.pdf")), Preservation.read(file("wasm-styled.pdf")))
      assert_equal(
        JSON.parse(command(native, "describe", file("styled.pdf"))),
        JSON.parse(command(native, "describe", file("wasm-styled.pdf")))
      )
      [150, 300].each do |dpi|
        command("pdftoppm", "-r", dpi, "-png", file("wasm.pdf"), file("wasm-#{dpi}"))
        [1, 2].each do |page|
          assert_equal(
            Digest::SHA256.file(file("edited-#{dpi}-#{page}.png")).hexdigest,
            Digest::SHA256.file(file("wasm-#{dpi}-#{page}.png")).hexdigest
          )
        end

        %w[styled wasm-styled].each do |name|
          command("pdftoppm", "-r", dpi, "-png", file("#{name}.pdf"), file("#{name}-#{dpi}"))
        end

        [1, 2].each do |page|
          assert_equal(
            Digest::SHA256.file(file("styled-#{dpi}-#{page}.png")).hexdigest,
            Digest::SHA256.file(file("wasm-styled-#{dpi}-#{page}.png")).hexdigest
          )
        end
      end
    end

    private

    def command(*arguments)
      result = Mainz.capture(*arguments)
      assert(result.status.success?, "#{arguments.inspect}: #{result.stdout}#{result.stderr}")
      result.stdout
    end

    def contents(path)
      pdf = JSON.parse(command("qpdf", "--json", "--json-stream-data=inline", path))
      objects = pdf["qpdf"][1]
      normalize = -> (value, parents = []) {
        if value.is_a?(String) && value.end_with?(" R") && objects.key?("obj:#{value}")
          if parents.include?(value)
            {"cycle" => true}
          else
            node = objects["obj:#{value}"]
            if node.key?("value")
              normalize.call(node["value"], parents + [value])
            else
              stream = node["stream"]
              {
                "data" => stream["data"],
                "dict" => normalize.call(
                  stream["dict"].reject do |key, _|
                    %w[/Length /Filter /DecodeParms].include?(key)
                  end,
                  parents + [value]
                )
              }
            end
          end
        elsif value.is_a?(Hash)
          value.transform_values { |item| normalize.call(item, parents) }
        elsif value.is_a?(Array)
          value.map { |item| normalize.call(item, parents) }
        else
          value
        end
      }
      normalize.call(objects["trailer"]["value"]["/Root"])
    end

    def file(name) = @directory.join(name)
  end
end
