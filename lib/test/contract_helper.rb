# frozen_string_literal: true

require "minitest/autorun"

require_relative "fixtures"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::Preservation)

module Mainz
  module ContractHelper
    include Fixtures

    def setup
      @directory = Pathname(Dir.mktmpdir("contract-", Mainz.workspace("tmp/test/lib").to_s))
      @cli = File.expand_path(ENV.fetch("MAINZ_CLI"))
      @source = file("prepared.pdf")
      @original = fixture(@source)
      write("inputs.json", {"input" => @source.to_s})
      write("plan.json", plan)
    end

    def teardown
      FileUtils.remove_entry(@directory) if @directory && File.exist?(@directory)
    end

    private

    def nested_fields(objects, _stream)
      objects[0] = objects[0].sub("/Names", "/AcroForm << /Fields [15 0 R] /CO [17 0 R 16 0 R] >> /Names")
      objects[2] = objects[2].sub("/Parent", "/Annots [16 0 R] /Parent")
      objects[3] = objects[3].sub("/Parent", "/Annots [17 0 R] /Parent")
      objects.concat(
        [
          "<< /T (Group) /FT /Tx /Kids [16 0 R 17 0 R] >>",
          "<< /Type /Annot /Subtype /Widget /T (Keep) /Parent 15 0 R /Rect [0 0 10 10] /P 3 0 R >>",
          "<< /Type /Annot /Subtype /Widget /T (Remove) /Parent 15 0 R /Rect [0 0 10 10] /P 4 0 R >>"
        ]
      )
    end

    def page_navigation(objects, _stream)
      objects[0] = objects[0].sub(
        "/Names <<",
        "/OpenAction [3 0 R /Fit] /AcroForm << /Fields [15 0 R 16 0 R] >> /Names << /Dests << /Names [(keep) [3 0 R /Fit] (remove) [4 0 R /Fit]] >>"
      )
      objects[2] = objects[2].sub("/Parent", "/Annots [15 0 R] /Parent")
      objects[3] = objects[3].sub("/Parent", "/Annots [16 0 R] /Parent")
      objects.concat(
        [
          "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Keep) /Rect [0 0 10 10] /P 3 0 R >>",
          "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Remove) /Rect [0 0 10 10] /P 4 0 R >>"
        ]
      )
    end

    def command(*arguments, ok: true, input: nil)
      result = Mainz.capture(*arguments, input: input)
      assert_equal(ok, result.status.success?, "#{arguments.inspect}: #{result.stdout}#{result.stderr}")
      result
    end

    def failure_code(path) = JSON.parse(command(@cli, "verify", path, ok: false).stderr)["code"]

    def pdf_json(path) = JSON.parse(command("qpdf", "--json", "--json-stream-data=inline", path).stdout)

    def assert_raster(expected, actual)
      assert_equal(
        Digest::SHA256.file(file(expected)).hexdigest,
        Digest::SHA256.file(file(actual)).hexdigest,
        "#{expected} != #{actual}"
      )
    end

    def page_snapshot(path, index)
      pdf = pdf_json(path)
      objects = pdf["qpdf"][1]
      normalize = -> (value) {
        case value
        when String
          if value.end_with?(" R")
            item = objects.fetch("obj:#{value}")
            if item.key?("stream")
              stream = item["stream"]
              {
                "data" => stream["data"],
                "dict" => normalize.call(
                  stream["dict"].reject { |key, _| %w[/Length /Filter /DecodeParms].include?(key) }
                )
              }
            else
              normalize.call(item["value"])
            end
          else
            value
          end

        when Hash
          value.reject { |key, _| key == "/Parent" }.transform_values { |item| normalize.call(item) }
        when Array
          value.map { |item| normalize.call(item) }
        else
          value
        end
      }
      page = resolve(pdf["pages"][index]["object"], objects)
      effective = page.reject { |key, _| key == "/Parent" }
      while page.key?("/Parent")
        page = resolve(page["/Parent"], objects)
        %w[/MediaBox /CropBox /Resources /Rotate].each { |key|
          effective[key] = page[key] if !effective.key?(key) && page.key?(key)
        }
      end

      normalize.call(effective)
    end

    def page_two(snapshot)
      _, _, objects, pdf = snapshot
      page = resolve(pdf["pages"][1]["object"], objects)
      row = resolve(page["/Resources"]["/XObject"]["/Row"], objects)
      shape = resolve(row["dict"]["/Resources"]["/XObject"]["/Shape"], objects)
      [Base64.decode64(shape["data"]), shape["dict"]["/Resources"]]
    end

    def raster(path, dpi)
      command("pdftoppm", "-r", dpi, "-png", path, file("#{path.basename(".pdf")}-#{dpi}"))
    end

    def resolve(value, objects)
      return value unless value.is_a?(String) && value.end_with?(" R")

      node = objects.fetch("obj:#{value}")
      node.key?("value") ? node["value"] : node["stream"]
    end

    def snapshot(path)
      command("qpdf", "--check", path)
      pdf = pdf_json(path)
      objects = pdf["qpdf"][1]
      decode = -> (reference) { Base64.decode64(resolve(reference, objects)["data"]).force_encoding(Encoding::UTF_8) }
      catalog = resolve(objects["trailer"]["value"]["/Root"], objects)
      attachments = {}
      visit = -> (tree) {
        tree = resolve(tree, objects)
        tree.fetch("/Names", []).each_slice(2) do |name, specification|
          specification = resolve(specification, objects)
          attachments[name.delete_prefix("u:")] = decode.call(resolve(specification["/EF"], objects)["/F"])
        end

        tree.fetch("/Kids", []).each { |kid| visit.call(kid) }
      }
      visit.call(resolve(catalog["/Names"], objects)["/EmbeddedFiles"])
      manifest = JSON.parse(attachments.fetch("mainz.json"))
      manifest["regions"].each_value do |region|
        next unless region.key?("recordSet")

        references = region.delete("baselineRefs")
        region["records"] = manifest["recordSets"][region.delete("recordSet")].map do |record|
          record.merge("baseline" => references[record["baseline"]])
        end
      end

      manifest.delete("recordSets")
      page = resolve(pdf["pages"][0]["object"], objects)
      content = pdf["pages"][0]["contents"].map { |reference| decode.call(reference) }.join("\n")
      records = manifest["regions"].values.flat_map do |region|
        region["records"].map do |record|
          resources = resolve(page["/Resources"], objects)
          data = content
          record["path"].each do |step|
            form = resolve(resolve(resources["/XObject"], objects)["/#{step["resource"]}"], objects)
            data = Base64.decode64(form["data"])
            resources = resolve(form["dict"]["/Resources"], objects)
          end

          scope = data[%r{/Figure /#{Regexp.escape(record["marker"])} BDC(.*?)EMC}m, 1]
          alpha = scope[%r{/([A-Za-z0-9.-]+) gs}, 1]
          state = resolve(resolve(resources["/ExtGState"], objects)["/#{alpha}"], objects)
          [record["baseline"], scope, state]
        end
      end

      assert_equal("Unrelated attachment.\n", attachments["notes.txt"])
      [manifest, records, objects, pdf]
    end
  end
end
