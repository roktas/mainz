# frozen_string_literal: true

# Owns PDF fixture construction shared by native contracts and focused WASM parity.
module Mainz
  module Fixtures
    CHOICES = {
      "width" => 0.2,
      "color" => "#123456",
      "opacity" => 0.65,
      "guide-display" => "inline",
      "guide-fill" => 0.4,
      "guide-color" => "#FF0000",
      "fill-opacity" => 0.2,
      "fill-color" => "#00FF00"
    }.freeze

    def large_input_fixture
      source = file("large-input.pdf")
      fixture(source, pdf_objects: -> (objects, stream) { objects << stream.call("", "x" * (65 * 1024 * 1024)) })
      source
    end

    def large_preview_fixture
      text = "Comment\0" + "x" * (16 * 1024 * 1024 + 1)
      chunk = "tEXt" + text
      image = preview_png.dup.insert(33, [text.bytesize].pack("N") + chunk + [Zlib.crc32(chunk)].pack("N"))
      file("large-preview.png").binwrite(image)
      source = file("large-preview.pdf")
      preview_fixture(source, image)
      source
    end

    def scoped_preview_fixture
      source = file("preview-scope.pdf")
      fixture(
        source,
        -> (manifest) {
          manifest["pages"] = Array.new(2) { {"preview" => "page.png"} }
          manifest["regions"]["filled"]["page"] = 1
          manifest["targets"]["pattern"] << "filled"
          manifest["targets"].delete("filled")
          manifest["parameters"].delete("fill-display")
          %w[fill-opacity fill-color].each { manifest["parameters"][it]["binding"]["targets"] = ["pattern"] }
        },
        pdf_objects: -> (objects, stream) {
          fill = objects[4].slice!(%r{/Figure /Fills BDC.*?EMC EMC}m)
          objects[3] = objects[2].sub("/Contents 5", "/Contents 12")
          objects[11] = stream.call("", fill)
        }
      )
      document = HexaPDF::Document.open(source)
      document.files.add(StringIO.new(preview_png), name: "page.png", mime_type: "image/png")
      document.write(source.to_s)
      source
    end

    def dense_preview_fixture
      source = file("preview-dense.pdf")
      preview_fixture(source) do |document|
        document.catalog[:Dense] = Array.new(130_000) { {} }
        document.catalog[:PreviewName] = "page.png"
        document.catalog[:Cycle] = document.catalog
      end
      changed = operation(source, "preview-dense-changed.pdf", {"opacity" => 0.4})
      [source, changed]
    end

    def fanout_preview_fixture
      source = file("preview-fanout.pdf")
      preview_fixture(source) do |document|
        document.catalog[:Dense] = Array.new(4_194_304, 0)
      end
      changed = operation(source, "preview-fanout-changed.pdf", {"opacity" => 0.4})
      changed
    end

    def fixed_visibility_fixture
      source = file("fixed-visibility.pdf")
      original = fixture(
        source,
        -> (manifest) {
          manifest["parameters"].reject! { |_, parameter| parameter["binding"]["property"] == "display" }
        }
      )
      [source, original]
    end

    def dense_manifest_fixture
      source = file("dense-manifest.pdf")
      fixture(
        source,
        -> (manifest) { manifest["groups"] = Array.new(17_000) { {"title" => "x", "parameters" => []} } }
      )
      source
    end

    def precise_baselines_fixture
      source = file("precise-baselines.pdf")
      fixture(
        source,
        -> (manifest) {
          %w[dark dim].each { |id| manifest["baselines"][id]["strokeOpacity"] = "0.123456789" }
          manifest["parameters"]["opacity"]["schema"]["default"] = 0.123456789
          manifest["baselines"]["hidden"]["width"] = "0.0000001"
          parameter(manifest, "guide-width", "guides", "stroke-width")
        },
        pdf_objects: replace_object(4, "/GuidePaint BDC q +.2000000000000000000 w", "/GuidePaint BDC q 0.0000001 w")
      )
      source
    end

    def opaque_fixture
      source = file("opaque-identities.pdf")
      suffix = "\"\\雪/~"
      opacity = "opacity#{suffix}"
      fixture(
        source,
        -> (manifest) {
          records = manifest["regions"]["rows"].delete("records")
          manifest["recordSets"] = {"set#{suffix}" => records.map { it.merge("baseline" => it["baseline"] + suffix) }}
          manifest["regions"]["rows"].merge!(
            "recordSet" => "set#{suffix}",
            "baselineRefs" => %w[dark dim].to_h { [it + suffix, it + suffix] }
          )
          %w[regions baselines targets parameters].each do |field|
            manifest[field].transform_keys! { it + suffix }
          end

          manifest["regions"].each_value do |region|
            region.fetch("records", []).each { it["baseline"] += suffix }
          end

          manifest["targets"].each_value { it.map! { |id| id + suffix } }
          manifest["parameters"].each_value { it["binding"]["targets"].map! { |id| id + suffix } }
          manifest["groups"].each { it["parameters"].map! { |id| id + suffix } }
        }
      )
      [source, suffix, opacity]
    end

    def different_alpha_fixture
      source = file("different-alpha.pdf")
      fixture(
        source,
        authored_baseline: true,
        pdf_objects: -> (objects, _) {
          [6, 14].each do |index|
            objects[index] = objects[index].sub("\nstream\n", "\nstream\n%#{"x" * (136 * 1024)}\n")
          end

          objects[14] = objects[14].sub("/CA 0.25", "/CA 0.3")
        }
      )
      source
    end

    def duplicate_fill_fixture
      source = file("duplicate-fill-spelling.pdf")
      fixture(
        source,
        pdf_objects: replace_object(
          4,
          "\nendstream",
          "\n+010.0 00100.00 040.000 40. re 20.0 +110 0020 20.00 re f\nendstream"
        )
      )
      source
    end

    def labeled_fixture
      source = file("extraction-pages.pdf")
      manifest = fixture(source, method(:across_pages), pdf_objects: method(:across_page_objects))
      [source, manifest]
    end

    def shared_fixture
      source = file("shared.pdf")
      fixture(source, method(:shared_regions), pdf_objects: method(:shared_objects))
      source
    end

    def profiles_fixture
      source = file("profiles.pdf")
      manifest = fixture(source, method(:profile_fixture), pdf_objects: method(:across_page_objects))
      [source, manifest]
    end

    def expanded_fixture
      fixture(
        file("expanded-limit.pdf"),
        -> (manifest) {
          shared_regions(manifest)
          manifest["recordSets"]["row"] *= 500
          499.times do |index|
            manifest["regions"]["copy-#{index}"] = manifest["regions"]["rows"]
            manifest["targets"]["pattern"] << "copy-#{index}"
          end
        },
        pdf_objects: method(:shared_objects)
      )
      file("expanded-limit.pdf")
    end

    def expanded_text_fixture
      fixture(
        file("expanded-text-limit.pdf"),
        -> (manifest) {
          shared_regions(manifest)
          id = "x" * 4096
          manifest["baselines"][id] = manifest["baselines"].delete("dark")
          manifest["regions"]["rows"]["baselineRefs"]["first"] = id
          manifest["recordSets"]["row"] = (manifest["recordSets"]["row"] * 500).each_with_index.map do |record, index|
            record.merge("path" => [record["path"][0], {"resource" => "Shape", "occurrence" => index}])
          end
          70.times do |index|
            manifest["regions"]["copy-#{index}"] = manifest["regions"]["rows"].merge("marker" => "Copy#{index}")
            manifest["targets"]["pattern"] << "copy-#{index}"
          end
        },
        pdf_objects: method(:shared_objects)
      )
      file("expanded-text-limit.pdf")
    end

    def alpha_fixture(source, alpha)
      fixture(
        source,
        -> (manifest) {
          manifest["parameters"]["opacity"].delete("value")
          manifest["baselines"]["dim"]["strokeOpacity"] = alpha.to_s
          record = manifest["regions"]["rows"]["records"][1]
          record["marker"] = "Paint2"
          record["path"][1]["occurrence"] = 0
        },
        pdf_objects: -> (objects, _) {
          objects[5] = objects[5].sub("q 2 0 0 2 80 0 cm /Shape Do Q", "")
          objects[6] = objects[6].sub("/Paint <<>>", "/Paint <<>> /Paint2 <<>>").sub("/CA 0.15", "/CA 1")
          scope = objects[6].split("\nstream\n", 2)[1].delete_suffix("\nendstream")
          objects[6] = objects[6].sub("\nendstream", "\n#{scope.sub("/Paint BDC", "/Paint2 BDC")}\nendstream")
        }
      )
    end

    def resources_fixture(source, index, key)
      fixture(
        source,
        pdf_objects: -> (objects, _) {
          objects[index] = objects[index].sub("/Resources <<", "/Resources << /#{key} []")
        }
      )
    end

    def ineligible_fixture(source)
      fixture(
        source,
        -> (manifest) { manifest["parameters"]["guide-fill"]["binding"]["targets"] << "pattern" }
      )
    end

    def moves_fixture(rectangle, suffix)
      fixture(file("empty-moves.pdf"), pdf_objects: replace_object(4, rectangle, rectangle + suffix))
    end

    def fills_fixture(source, keep_fill)
      fixture(
        source,
        -> (manifest) {
          across_pages(manifest)
          manifest["parameters"].select! { |id, _| id == "guide-fill" || (keep_fill && id == "fill-color") }
          manifest["groups"] = []
          unless keep_fill
            %w[targets regions baselines].each { |key| manifest[key].delete("filled") }
          end
        },
        authored_baseline: true,
        pdf_objects: method(:across_page_objects)
      )
    end

    def preview_png
      Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC")
    end

    def preview_fixture(path, image = preview_png)
      fixture(
        path,
        -> (manifest) {
          manifest["pages"] = [
            {"name" => "Practice", "preview" => "page.png"},
            {"preview" => "page.png"}
          ]
        }
      )
      document = HexaPDF::Document.open(path)
      document.files.add(StringIO.new(image), name: "page.png", mime_type: "image/png")
      yield document if block_given?
      document.write(path.to_s)
    end

    def across_pages(manifest)
      manifest["regions"]["guides"]["page"] = 1
      manifest["targets"]["pattern"] << "guides"
      manifest["targets"].delete("guides")
      manifest["parameters"].delete("guide-display")
      %w[guide-fill guide-color].each { |id| manifest["parameters"][id]["binding"]["targets"] = ["pattern"] }
      manifest["groups"] << {"title" => "Guides", "parameters" => %w[guide-fill guide-color]}
    end

    def across_page_objects(objects, stream)
      objects[0] = objects[0].sub(
        "/Names",
        "/PageLabels << /Nums [0 << /S /r /P (Practice-) >> 1 << /S /D /St 7 /P (Practice-) >>] >> /AF [9 0 R 13 0 R] /Names"
      )
      objects[1] = objects[1].sub("/MediaBox", "/Rotate 90 /CropBox [10 20 350 340] /MediaBox")
      objects[2] = objects[2].sub("/Type /Page", "/Type /Page /TrimBox [20 30 300 280]")
      objects[3] = objects[2].sub("/UserUnit 2", "/UserUnit 1").sub("/Contents 5", "/Contents 12")
      objects[11] = stream.call(
        "",
        "/Figure /Guides BDC /Figure /GuidePaint BDC q +.2000000000000000000 w 0.2 G 0 g /Hidden gs 10 100 40 40 re 20 110 20 20 re S Q EMC EMC"
      )
    end

    def fixture(path, mutate = nil, content: nil, authored_baseline: false, pdf_objects: nil)
      dark = {
        "paint" => "S",
        "width" => "+.2000000000000000000",
        "stroke" => {"operator" => "G", "operands" => ["0.2"]},
        "fill" => {"operator" => "g", "operands" => ["0"]},
        "strokeOpacity" => "1",
        "fillOpacity" => "0",
        "display" => "inline",
        "fillRule" => "nonzero"
      }
      manifest = {
        "version" => 1,
        "pages" => [{}, {}],
        "regions" => {
          "rows" => {
            "page" => 0,
            "marker" => "Rows",
            "records" => %w[dark dim].each_with_index.map do |baseline, index|
              {
                "path" => [{"resource" => "Row", "occurrence" => 0}, {"resource" => "Shape", "occurrence" => index}],
                "marker" => "Paint",
                "baseline" => baseline,
                "fill" => "none"
              }
            end
          },
          "guides" => {
            "page" => 0,
            "marker" => "Guides",
            "records" => [
              {"path" => [], "marker" => "GuidePaint", "baseline" => "hidden", "fill" => "latent"}
            ]
          },
          "filled" => {
            "page" => 0,
            "marker" => "Fills",
            "records" => [
              {"path" => [], "marker" => "FillPaint", "baseline" => "filled", "fill" => "existing"}
            ]
          }
        },
        "baselines" => {
          "dark" => dark,
          "dim" => dark.merge("strokeOpacity" => "0.25"),
          "hidden" => dark.merge("display" => "none", "fillRule" => "evenodd"),
          "filled" => dark.merge("paint" => "f*", "fillOpacity" => "0.4", "fillRule" => "evenodd")
        },
        "targets" => {"pattern" => ["rows"], "guides" => ["guides"], "filled" => ["filled"]},
        "parameters" => {},
        "groups" => [
          {"title" => "Patterns", "description" => "Reference shapes for practice.", "parameters" => %w[opacity width]}
        ]
      }
      parameter(manifest, "opacity", "pattern", "stroke-opacity", 0.15)
      manifest["parameters"]["opacity"]["schema"]["description"] = "Fractional opacity: \"quoted\" \\ path; Türkçe \n text"
      parameter(manifest, "width", "pattern", "stroke-width")
      parameter(manifest, "color", "pattern", "stroke-color")
      parameter(manifest, "display", "pattern", "display")
      parameter(manifest, "guide-display", "guides", "display")
      parameter(manifest, "guide-fill", "guides", "fill-opacity")
      parameter(manifest, "guide-color", "guides", "fill-color")
      parameter(manifest, "fill-display", "filled", "display")
      parameter(manifest, "fill-opacity", "filled", "fill-opacity")
      parameter(manifest, "fill-color", "filled", "fill-color")
      if authored_baseline
        manifest["parameters"]["opacity"].delete("value")
        manifest["regions"]["rows"]["records"][1]["path"][1].merge!("resource" => "Dim", "occurrence" => 0)
      end

      mutate&.call(manifest)
      body = content || <<~PDF
          /Span BMC
          /Figure /Rows BDC q /Row Do Q EMC
          /Figure /Guides BDC /Figure /GuidePaint BDC q +.2000000000000000000 w 0.2 G 0 g /Hidden gs
          10 100 40 40 re 20 110 20 20 re S Q EMC EMC
          /Figure /Fills BDC /Figure /FillPaint BDC q +.2000000000000000000 w 0.2 G 0 g /Filled gs
          140 100 20 20 re 145 105 10 10 re f* Q EMC EMC
          EMC
          q 0.12345678901234567890123456789 0 0 1 0 0 cm 1 G 0 0 m 10 10 l S Q
        PDF
      stream = -> (dictionary, data) {
        "<< #{dictionary} /Length #{data.bytesize} >>\nstream\n".b + data.b + "\nendstream"
      }
      resources = "<< /XObject << /Row 6 0 R >> /Properties << /Rows <<>> /Guides <<>> /GuidePaint <<>> /Fills <<>> /FillPaint <<>> >> /ExtGState << /Hidden << /Type /ExtGState /CA 0 /ca 0 >> /Filled << /Type /ExtGState /CA 1 /ca 0.4 >> >> >>"
      objects = [
        "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Kids [10 0 R 11 0 R] >> >> >>",
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 360 360] >>",
        "<< /Type /Page /Parent 2 0 R /UserUnit 2 /Contents 5 0 R /Resources #{resources} >>",
        "<< /Type /Page /Parent 2 0 R /Contents 12 0 R /Resources << /XObject << /Row 6 0 R >> >> >>",
        stream.call("", body),
        stream.call(
          "/Type /XObject /Subtype /Form /BBox [0 0 300 300] /Resources << /XObject << /Shape 7 0 R >> >>",
          "/Shape Do q 2 0 0 2 80 0 cm /Shape Do Q"
        ),
        stream.call(
          "/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Properties << /Paint <<>> >> /ExtGState << /Alpha << /Type /ExtGState /CA 0.15 /ca 0 >> >> >>",
          "/Figure /Paint BDC q +.2000000000000000000 w 0.2 G 0 g /Alpha gs 10.12345678901234567890123456789 10 30 30 re S Q EMC"
        ),
        stream.call("/Type /EmbeddedFile /Subtype /application#2Fjson", JSON.generate(manifest)),
        "<< /Type /Filespec /F (mainz.json) /UF (mainz.json) /EF << /F 8 0 R /UF 8 0 R >> >>",
        "<< /Names [(mainz.json) 9 0 R] /Limits [(mainz.json) (mainz.json)] >>",
        "<< /Names [(notes.txt) 13 0 R] /Limits [(notes.txt) (notes.txt)] >>",
        stream.call("", "q /Row Do Q"),
        "<< /Type /Filespec /F (notes.txt) /EF << /F 14 0 R >> >>",
        stream.call("/Type /EmbeddedFile", "Unrelated attachment.\n")
      ]
      if authored_baseline
        objects[5] = stream.call(
          "/Type /XObject /Subtype /Form /BBox [0 0 300 300] /Resources << /XObject << /Shape 7 0 R /Dim 15 0 R >> >>",
          "/Shape Do q 2 0 0 2 80 0 cm /Dim Do Q"
        )
        objects[3] = "<< /Type /Page /Parent 2 0 R /Contents 12 0 R /Resources << /XObject << /Row 16 0 R >> >> >>"
        objects << objects[6].sub("/CA 0.15", "/CA 0.25")
        objects <<
          stream.call(
            "/Type /XObject /Subtype /Form /BBox [0 0 300 300] /Resources << /XObject << /Shape 17 0 R >> >>",
            "/Shape Do q 2 0 0 2 80 0 cm /Shape Do Q"
          )
        objects << objects[6]
        objects[6] = objects[6].sub("/CA 0.15", "/CA 1.00")
      end

      if pdf_objects
        pdf_objects.call(objects, stream)
        objects.map! do |object|
          if object.include?("\nstream\n")
            dictionary, data = object.split("\nstream\n", 2)
            data = data.sub(/\nendstream\z/, "")
            dictionary.sub(%r{/Length \d+}, "/Length #{data.bytesize}").b + "\nstream\n" + data.b + "\nendstream"
          else
            object
          end
        end
      end

      pdf = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".b
      offsets = []
      objects.each_with_index do |object, index|
        offsets << pdf.bytesize
        pdf << "#{index + 1} 0 obj\n" << object.b << "\nendobj\n"
      end

      xref = pdf.bytesize
      pdf << "xref\n0 #{objects.length + 1}\n0000000000 65535 f \n"
      offsets.each { |offset| pdf << format("%010d 00000 n \n", offset) }
      pdf << "trailer << /Size #{objects.length + 1} /Root 1 0 R >>\nstartxref\n#{xref}\n%%EOF\n"
      path.binwrite(pdf)
      manifest
    end

    def parameter(manifest, id, target, property, value = nil)
      schema = {"type" => property.end_with?("opacity", "width") ? "number" : "string"}
      schema.merge!("minimum" => 0, "maximum" => 1) if property.end_with?("opacity")
      schema.merge!("exclusiveMinimum" => 0, "maximum" => 2) if property == "stroke-width"
      schema["enum"] = %w[inline none] if property == "display"
      definition = {"schema" => schema, "binding" => {"targets" => [target], "property" => property}}
      definition["value"] = value unless value.nil?
      manifest["parameters"][id] = definition
    end

    def profile_fixture(manifest)
      across_pages(manifest)
      manifest["parameters"].each { |id, parameter| parameter.merge!("family" => "fixture", "key" => id) }
      manifest["parameters"]["width"]["schema"].merge!(
        "description" => "Outline thickness.",
        "details" => "Changes every eligible outline.\n\n<b>Width</b> is plain text."
      )
      manifest["groups"][0]["details"] = "Practice shapes and their controls.\n\nUse the same settings across pages."
      manifest["profileSets"] = [
        {
          "id" => "print",
          "family" => "fixture",
          "name" => "Style profile",
          "description" => "Printer styles",
          "details" => "Choose one complete set of authored styles.",
          "parameters" => %w[width guide-color guide-fill],
          "profiles" => [
            {
              "id" => "generic",
              "name" => "Generic",
              "description" => "Original styles",
              "details" => "",
              "overrides" => {}
            },
            {
              "id" => "inkjet",
              "name" => "Inkjet",
              "description" => "Light fills and fine lines",
              "details" => "Pale fills suit inkjet printers.\n\nSome printers show visible dots. <b>Çizgi</b> is plain text.",
              "overrides" => {"width" => 0.15, "guide-color" => "#A9A9A9", "guide-fill" => 0.4}
            }
          ]
        }
      ]
    end

    def shared_objects(objects, _stream)
      objects[2] = objects[2].sub("/Rows <<>>", "/Rows <<>> /Rows2 <<>>")
      objects[4] = objects[4].sub("\nendstream", "/Figure /Rows2 BDC q /Row Do Q EMC\nendstream")
      objects[6] = objects[6].sub("\nstream\n", "\nstream\n%#{"x" * (136 * 1024)}\n")
    end

    def shared_regions(manifest)
      records = manifest["regions"]["rows"].delete("records")
      manifest["recordSets"] = {
        "row" => records.zip(%w[first second]).map { |record, slot| record.merge("baseline" => slot) }
      }
      manifest["regions"]["rows"].merge!("recordSet" => "row", "baselineRefs" => {"first" => "dark", "second" => "dim"})
      manifest["regions"]["other-rows"] = {
        "page" => 0,
        "marker" => "Rows2",
        "recordSet" => "row",
        "baselineRefs" => {"first" => "other-dark", "second" => "other-dim"}
      }
      [["dark", "0.7"], ["dim", "0.9"]].each do |id, alpha|
        manifest["baselines"]["other-#{id}"] = manifest["baselines"][id].merge("strokeOpacity" => alpha)
      end

      manifest["targets"]["other"] = ["other-rows"]
      %w[opacity display].each do |id|
        parameter = JSON.parse(JSON.generate(manifest["parameters"][id]))
        parameter["binding"]["targets"] = ["other"]
        manifest["parameters"]["other-#{id}"] = parameter
      end
    end

    def padded_manifest(size)
      -> (objects, stream) {
        payload = objects[7].split("stream\n", 2)[1].sub(/\nendstream\z/, "")
        padded = payload + " " * (size - payload.bytesize)
        objects[7] = stream.call(
          "/Type /EmbeddedFile /Subtype /application#2Fjson /Filter /FlateDecode",
          Zlib::Deflate.deflate(padded)
        )
      }
    end

    def replace_object(index, before, after)
      -> (objects, _) {
        raise "Missing fixture token in object #{index}" unless objects[index].include?(before)
        objects[index] = objects[index].gsub(before, after)
      }
    end

    def plan
      {
        "version" => 1,
        "sources" => {
          "baseline" => {"input" => "input", "overrides" => {}},
          "edited" => {"input" => "input", "overrides" => {"opacity" => 0.65}},
          "plain" => {"input" => "input", "overrides" => {}}
        },
        "parts" => [
          {"pages" => [{"source" => "plain", "page" => 1}]},
          {
            "pages" => [
              {"source" => "baseline", "page" => 0},
              {"source" => "edited", "page" => 0},
              {"blank" => {"width" => 210, "height" => 297}}
            ],
            "copies" => 2,
            "front" => true
          }
        ]
      }
    end

    def operation(input, name, request = nil, reset: false)
      output = file(name)
      FileUtils.rm_f(output)
      arguments = [@cli, reset ? "reset" : "style", input, "--output", output]
      arguments += [reset ? "--ids" : "--overrides", write("request.json", request)] unless request.nil?
      command(*arguments)
      output
    end

    def extract(input, name, selection)
      destination = file(name)
      FileUtils.rm_f(destination)
      request = write("pages.json", selection)
      command(@cli, "extract", input, "--pages", request, "--output", destination)
      destination
    end

    def write(name, value)
      path = file(name)
      path.write(JSON.generate(value))
      path
    end

    def file(name) = @directory.join(name)
    def describe(path) = JSON.parse(command(@cli, "describe", path).stdout)

    def compose(request, name = "composed.pdf", ok: true)
      write("plan.json", request)
      destination = file(name)
      FileUtils.rm_f(destination)
      result = command(
        @cli,
        "compose",
        file("plan.json"),
        "--inputs",
        file("inputs.json"),
        "--output",
        destination,
        ok: ok
      )
      refute_path_exists(destination) unless ok
      [destination, result]
    end

    def styled
      @styled ||= operation(@source, "edited.pdf", CHOICES)
    end

    def build_parity
      @source = file("prepared.pdf")
      fixture(@source)
      styled
      # Match the combined reset/override operation observed by wasm.mjs.
      reset = operation(styled, "style-reset.pdf", ["width", "color"], reset: true)
      operation(reset, "styled.pdf", {"color" => "#ABCDEF", "opacity" => 0.5})
      {"pristine" => [0], "ordinary" => [1], "reverse" => [1, 0]}.each do |name, pages|
        extract(@source, "extracted-#{name}.pdf", pages)
      end
      ordinary = file("ordinary.pdf")
      command("qpdf", @source, "--remove-attachment=mainz.json", "--", ordinary)
      extract(ordinary, "ordinary-reverse.pdf", [1, 0])
      shared, = shared_fixture
      edited = operation(shared, "shared-edited.pdf", {"color" => "#123456"})
      changed = operation(edited, "shared-changed.pdf", {"other-opacity" => 0.4})
      operation(changed, "shared-chained.pdf", ["color"], reset: true)
      dense_manifest_fixture
      precise_baselines_fixture
      opaque_fixture
      different_alpha_fixture
      duplicate_fill_fixture
      expanded_fixture
      expanded_text_fixture
      labeled_fixture
      alpha_fixture(file("scope-alpha.pdf"), 0.25)
      resources_fixture(file("invalid-resources.pdf"), 6, "XObject")
      ineligible_fixture(file("ineligible-targets.pdf"))
      moves_fixture("10 100 40 40 re 20 110 20 20 re", " 10 100 m 20 110 m")
      preview_fixture(file("preview.pdf"))
      scoped_preview_fixture
      _, dense = dense_preview_fixture
      extract(dense, "preview-dense-extracted.pdf", [0])
      fanout_preview_fixture
      large_preview_fixture
      fixed, = fixed_visibility_fixture
      write("fixed-visibility-description.json", describe(fixed))
      operation(fixed, "fixed-visibility-edited.pdf", {"width" => 0.2, "guide-fill" => 0.4, "fill-color" => "#00FF00"})
      profiles_fixture
      write("profiles-description.json", describe(file("profiles.pdf")))
      [false, true].each do |keep_fill|
        name = keep_fill ? "fill-mixed" : "fill-only"
        source = file("#{name}.pdf")
        fills_fixture(source, keep_fill)
        write("inputs.json", {"input" => source.to_s})
        [0, 1].each do |index|
          extract(source, "#{name}-extracted-#{index}.pdf", [index])
          compose({"version" => 1, "sources" => {"original" => {"input" => "input", "overrides" => {}}},
            "parts" => [{"pages" => [{"source" => "original", "page" => index}]}]}, "#{name}-composed-#{index}.pdf")
        end
      end
      large = large_input_fixture
      write("inputs.json", {"book" => large.to_s})
      compose({"version" => 1, "sources" => {"a" => {"input" => "book", "overrides" => {}}, "b" => {"input" => "book", "overrides" => {}}},
        "parts" => [{"pages" => [{"source" => "a", "page" => 0}, {"source" => "b", "page" => 1}]}]}, "large-shared.pdf")
      write("inputs.json", {"input" => @source.to_s})
      composed, result = compose(plan)
      file("composition-provenance.json").binwrite(result.stdout)
      operation(composed, "composed-reset.pdf", reset: true)
      [150, 300].each { |dpi| command("pdftoppm", "-r", dpi, "-png", styled, file("edited-#{dpi}")) }
      write("plan.json", plan)
    end
  end

  class ParityFixtures
    include Fixtures

    def initialize(directory, cli)
      @directory = directory
      @cli = cli
    end

    private

    def command(*arguments, ok: true, input: nil)
      result = Mainz.capture(*arguments, input: input)
      raise "#{arguments.inspect}: #{result.stdout}#{result.stderr}" unless result.status.success? == ok
      result
    end
  end
end
