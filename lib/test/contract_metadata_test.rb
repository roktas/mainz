# frozen_string_literal: true

require_relative "contract_helper"

module Mainz
  class ContractMetadataTest < Minitest::Test
    include ContractHelper

    def test_description_exposes_baselines_and_plain_text
      description = describe(@source)
      assert_equal(@original["groups"], description["groups"])
      assert_equal(2, description["pageCount"])
      assert_equal({"kind" => "mixed"}, description["parameters"]["opacity"]["baseline"])
      assert_equal({"kind" => "uniform", "value" => "none"}, description["parameters"]["guide-display"]["baseline"])
      assert_equal({"kind" => "uniform", "value" => "#333333"}, description["parameters"]["color"]["baseline"])
      assert_equal({"kind" => "mixed"}, description["parameters"]["width"]["baseline"])
      assert_equal(
        @original["parameters"]["opacity"]["schema"]["description"],
        description["parameters"]["opacity"]["parameter"]["schema"]["description"]
      )
      command(@cli, "verify", "-", input: @source.binread)
      active = file("active-content.pdf")
      fixture(
        active,
        pdf_objects: -> (objects, _) {
          objects[0] = objects[0].sub(
            "/Names",
            "/OpenAction << /S /JavaScript /JS (globalThis.mainzPdfScriptExecuted = true; fetch\\('https://example.invalid/pdf-script'\\);) >> /Names"
          )
          objects[2] = objects[2].sub(
            "/Resources",
            "/Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 100 100] /A << /S /URI /URI (https://example.invalid/pdf-link) >> >>] /Resources"
          )
        }
      )
      command(@cli, "verify", active)
      fixture(
        file("opaque-id.pdf"),
        -> (manifest) {
          parameter = manifest["parameters"].delete("opacity")
          parameter["schema"]["title"] = "Opacity"
          manifest["parameters"]["__proto__"] = parameter
          manifest["groups"][0]["parameters"][0] = "__proto__"
        }
      )
      command(@cli, "verify", file("opaque-id.pdf"))
    end

    def test_page_annotations_survive_page_operations
      source = file("annotated.pdf")
      pages = [
        {"name" => "Practice", "tags" => ["Guides", "guides"]},
        {"name" => "Practice", "tags" => []}
      ]
      fixture(source, -> (manifest) { manifest["pages"] = pages })
      command(@cli, "verify", source)
      assert_equal(pages, describe(source)["pages"])
      edited = operation(source, "annotated-edited.pdf", {"opacity" => 0.65})
      assert_equal(pages, describe(edited)["pages"])
      selected = extract(edited, "annotated-reversed.pdf", [1, 0])
      assert_equal(pages.reverse, describe(selected)["pages"])
      assert_equal([1], describe(selected)["parameters"]["opacity"]["pages"])
      assert_equal(Preservation.read(source).reverse, Preservation.read(selected))
      write("inputs.json", {"input" => source.to_s})
      composed, = compose(
        {
          "version" => 1,
          "sources" => {"original" => {"input" => "input", "overrides" => {}}},
          "parts" => [
            {"pages" => [1, 0].map { {"source" => "original", "page" => it} }, "copies" => 2},
            {"pages" => [{"blank" => {"width" => 100, "height" => 100}}]}
          ]
        },
        "annotated-composed.pdf"
      )
      assert_equal(pages.reverse * 2 + [{}], describe(composed)["pages"].map { it.except("label") })
    end

    def test_metadata_only_supports_page_operations
      source = file("metadata-only.pdf")
      annotation = {"name" => "Reference", "tags" => ["notes"]}
      fixture(
        source,
        -> (manifest) {
          manifest["pages"] = [{}, annotation]
          %w[regions baselines targets parameters].each { manifest[it] = {} }
          manifest.delete("groups")
        }
      )
      assert(JSON.parse(command(@cli, "verify", source).stdout)["valid"])
      assert_equal({}, describe(source)["parameters"])
      request = write("metadata-overrides.json", {})
      failure = command(
        @cli,
        "style",
        source,
        "--overrides",
        request,
        "--output",
        file("metadata-styled.pdf"),
        ok: false
      )
      assert_equal("missing-contract", JSON.parse(failure.stderr)["code"])
      failure = command(
        @cli,
        "style",
        source,
        "--profile",
        "original",
        "--output",
        file("metadata-profile.pdf"),
        ok: false
      )
      error = JSON.parse(failure.stderr)
      assert_equal("missing-contract", error["code"])
      assert_equal("PDF has no editable Mainz paint.", error["message"])
      selected = extract(source, "metadata-retained.pdf", [1])
      assert_equal([annotation], describe(selected)["pages"])
      command(@cli, "verify", selected)
      ordinary = extract(source, "metadata-removed.pdf", [0])
      assert_equal("missing-contract", failure_code(ordinary))
      assert_equal([{}], describe(ordinary)["pages"])
      assert_equal([page_snapshot(source, 1)], [page_snapshot(selected, 0)])
    end

    def test_page_metadata_rejects_invalid_values
      invalids = [
        [],
        [{}],
        [{}, {}, {}],
        [nil, {}],
        [{"name" => ""}, {}],
        [{"name" => "\u00a0"}, {}],
        [{"name" => "bad\nname"}, {}],
        [{"tags" => ["detail", "detail"]}, {}],
        [{"tags" => [" "]}, {}],
        [{"tags" => [1]}, {}],
        [{"unknown" => true}, {}]
      ]
      invalids.each_with_index do |pages, index|
        source = file("invalid-pages-#{index}.pdf")
        fixture(source, -> (manifest) { manifest["pages"] = pages })
        assert_equal("invalid-contract", failure_code(source), pages.inspect)
      end

      [-1, 0.5, 2, nil, "0"].each_with_index do |page, index|
        source = file("invalid-region-page-#{index}.pdf")
        fixture(source, -> (manifest) { manifest["regions"]["rows"]["page"] = page })
        assert_equal("invalid-contract", failure_code(source))
      end
    end

    def test_document_xmp_survives_style_and_extraction_without_composition_inheritance
      source = file("xmp.pdf")
      fixture(source)
      xml = "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title><rdf:Alt><rdf:li xml:lang=\"x-default\">Practice</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta>"
      document = HexaPDF::Document.open(source)
      document.catalog[:Metadata] = document.add({Type: :Metadata, Subtype: :XML}, stream: xml)
      document.write(source.to_s, update_fields: false)
      changed = operation(source, "xmp-styled.pdf", {"opacity" => 0.4})
      selected = extract(changed, "xmp-selected.pdf", [0])
      [changed, selected].each { |path| assert_equal(xml, HexaPDF::Document.open(path).catalog[:Metadata].stream) }
      write("inputs.json", {"input" => source.to_s})
      result, = compose(
        {
          "version" => 1,
          "sources" => {"source" => {"input" => "input", "overrides" => {}}},
          "parts" => [{"pages" => [{"source" => "source", "page" => 0}]}]
        },
        "xmp-composed.pdf"
      )
      assert_nil(HexaPDF::Document.open(result).catalog[:Metadata])
    end

    def test_baseline_summaries_retain_numeric_precision
      source = precise_baselines_fixture
      parameters = describe(source)["parameters"]
      assert_equal({"kind" => "uniform", "value" => 0.123456789}, parameters["opacity"]["baseline"])
      assert_equal("uniform", parameters["guide-width"]["baseline"]["kind"])
      assert_in_delta(7.055555555555555e-8, parameters["guide-width"]["baseline"]["value"], 1e-22)

      fixture(
        file("precise-mixed.pdf"),
        -> (manifest) {
          manifest["baselines"]["dark"]["strokeOpacity"] = "0.123456781"
          manifest["baselines"]["dim"]["strokeOpacity"] = "0.123456789"
        }
      )
      assert_equal({"kind" => "mixed"}, describe(file("precise-mixed.pdf"))["parameters"]["opacity"]["baseline"])
    end

    def test_unrepresentable_baselines_do_not_become_scalar_values
      color = file("unrepresentable-color.pdf")
      fixture(
        color,
        -> (manifest) {
          %w[dark dim].each do |id|
            manifest["baselines"][id]["stroke"] = {"operator" => "G", "operands" => ["0.5"]}
          end
        },
        pdf_objects: replace_object(6, "0.2 G", "0.5 G")
      )
      assert_equal("unrepresentable", describe(color)["parameters"]["color"]["baseline"]["kind"])

      width = file("unrepresentable-width.pdf")
      token = "1" + "0" * 308
      fixture(
        width,
        -> (manifest) {
          manifest["baselines"]["hidden"]["width"] = token
          parameter(manifest, "guide-width", "guides", "stroke-width")
        },
        pdf_objects: replace_object(4, "/GuidePaint BDC q +.2000000000000000000 w", "/GuidePaint BDC q #{token} w")
      )
      assert_equal("unrepresentable", describe(width)["parameters"]["guide-width"]["baseline"]["kind"])
    end

    def test_invalid_manifests_and_numeric_tokens_are_rejected
      mutations = [
        -> (m) { m["extra"] = true },
        -> (m) { m["parameters"]["opacity"]["value"] = nil },
        -> (m) { m["parameters"]["width"]["schema"]["minimum"] = "zero" },
        -> (m) { m["parameters"]["width"]["schema"].merge!("minimum" => 2, "exclusiveMaximum" => 2) },
        -> (m) { m["parameters"]["width"]["schema"]["enum"] = [1, 1.0] },
        -> (m) { m["parameters"]["display"]["schema"]["enum"] = ["inline"] },
        -> (m) { m["parameters"].reject! { |_, parameter| parameter["binding"]["targets"] == ["filled"] } },
        -> (m) { m["parameters"]["opacity"]["schema"]["default"] = 0.25 },
        -> (m) { m["regions"]["rows"]["records"].reverse! },
        -> (m) { m["regions"]["rows"]["records"][1]["path"][1]["occurrence"] = 0 },
        -> (m) { m["targets"]["guides"] << "rows" },
        -> (m) { m["baselines"]["dark"]["width"] = "1e-2" },
        -> (m) { m["groups"][0]["parameters"] << "opacity" },
        -> (m) { m["groups"][0]["description"] = false }
      ]
      ["+-0.2", "+", ".", "nan", "inf", "0.2e0", "0.2\n", " 0.2", "9" * 4000].each do |encoded|
        mutations << -> (m) { m["baselines"]["dark"]["width"] = encoded }
      end

      mutations.each_with_index do |mutation, index|
        source = file("invalid-#{index}.pdf")
        fixture(source, mutation)
        failure = command(@cli, "verify", source, ok: false)
        assert_equal(false, JSON.parse(failure.stdout)["valid"])
        assert_equal("invalid-contract", JSON.parse(failure.stderr)["code"])
      end

      [".2", "+0.2", "000.200", "0.200", "0.2" + "0" * 200].each do |encoded|
        fixture(file("numeric.pdf"), -> (m) { m["baselines"]["dark"]["width"] = encoded })
        command(@cli, "verify", file("numeric.pdf"))
      end
    end

    def test_tagged_bdc_inline_goto_oc_ais_partial_labels_and_long_remapped_ids
      tagged = file("tagged-bdc.pdf")
      fixture(
        tagged,
        content: <<~PDF
          /Artifact << /Type /Pagination >> BDC
          /Span << /MCID 0 /Lang (en) >> BDC
          /Figure /Rows BDC q /Row Do Q EMC
          /Figure /Guides BDC /Figure /GuidePaint BDC q +.2000000000000000000 w 0.2 G 0 g /Hidden gs
          10 100 40 40 re 20 110 20 20 re S Q EMC EMC
          /Figure /Fills BDC /Figure /FillPaint BDC q +.2000000000000000000 w 0.2 G 0 g /Filled gs
          140 100 20 20 re 145 105 10 10 re f* Q EMC EMC
          EMC
          EMC
        PDF
      )
      assert_equal(true, command(@cli, "verify", tagged).status.success?)

      oc_pdf = file("oc-editable.pdf")
      fixture(
        oc_pdf,
        content: <<~PDF
          /OC /Layer1 BDC
          /Figure /Rows BDC q /Row Do Q EMC
          /Figure /Guides BDC /Figure /GuidePaint BDC q +.2000000000000000000 w 0.2 G 0 g /Hidden gs
          10 100 40 40 re 20 110 20 20 re S Q EMC EMC
          /Figure /Fills BDC /Figure /FillPaint BDC q +.2000000000000000000 w 0.2 G 0 g /Filled gs
          140 100 20 20 re 145 105 10 10 re f* Q EMC EMC
          EMC
        PDF
      )
      assert_equal("unsupported-context", failure_code(oc_pdf))

      ais_pdf = file("ais-editable.pdf")
      fixture(
        ais_pdf,
        content: <<~PDF,
          q /ShapeAlpha gs
          /Figure /Rows BDC q /Row Do Q EMC
          /Figure /Guides BDC /Figure /GuidePaint BDC q +.2000000000000000000 w 0.2 G 0 g /Hidden gs
          10 100 40 40 re 20 110 20 20 re S Q EMC EMC
          /Figure /Fills BDC /Figure /FillPaint BDC q +.2000000000000000000 w 0.2 G 0 g /Filled gs
          140 100 20 20 re 145 105 10 10 re f* Q EMC EMC
          Q
        PDF
        pdf_objects: -> (objects, _stream) {
          objects[2] = objects[2].sub("/Hidden <<", "/ShapeAlpha << /Type /ExtGState /AIS true >> /Hidden <<")
        }
      )
      assert_equal("unsupported-context", failure_code(ais_pdf))

      inline_goto = file("inline-goto.pdf")
      doc = HexaPDF::Document.new
      p0 = doc.pages.add
      p1 = doc.pages.add
      doc.catalog[:Names] = {Dests: {Names: ["target0", [p0, :Fit], "target1", [p1, :Fit]]}}
      doc.outline.add_item("Ch 1", destination: nil)
      doc.catalog[:Outlines][:First][:A] = {S: :GoTo, D: "target0"}
      p0[:Annots] = [
        {Type: :Annot, Subtype: :Link, Rect: [0, 0, 10, 10], A: {S: :GoTo, D: "target0"}},
        {Type: :Annot, Subtype: :Link, Rect: [10, 0, 20, 10], A: {S: :GoTo, D: "target1"}}
      ]
      doc.write(inline_goto.to_s)
      write("inputs.json", {"book" => inline_goto.to_s})
      plan = {
        "version" => 1,
        "sources" => {"a" => {"input" => "book", "overrides" => {}}},
        "parts" => [{"pages" => [{"source" => "a", "page" => 0}]}]
      }
      composed, _ = compose(plan, "inline-goto-composed.pdf")
      out = HexaPDF::Document.open(composed)
      assert_equal("Ch 1", out.catalog[:Outlines][:First][:Title])
      annots = out.pages[0][:Annots]
      assert_equal(out.pages[0], annots[0][:A][:D][0])
      assert_nil(annots[1][:A][:D][0])

      partial = file("partial-labels.pdf")
      doc = HexaPDF::Document.new
      2.times { doc.pages.add }
      doc.catalog[:PageLabels] = {Nums: [1, {S: :D, St: 10}]}
      doc.write(partial.to_s)
      described = JSON.parse(command(@cli, "describe", partial).stdout)
      refute(described["pages"][0].key?("label"))
      assert_equal("10", described["pages"][1]["label"])

      acro = file("acro-no-fields.pdf")
      doc = HexaPDF::Document.new
      2.times { doc.pages.add }
      doc.catalog[:AcroForm] = {NeedAppearances: true}
      doc.write(acro.to_s)
      extracted = file("acro-extracted.pdf")
      FileUtils.rm_f(extracted)
      write("pages.json", [0])
      assert_equal(true, command(@cli, "extract", acro, "--pages", file("pages.json"), "--output", extracted).status.success?)

      long_id = "a" * 4096
      long_pdf = file("long-ids.pdf")
      fixture(
        long_pdf,
        -> (data) {
          data["parameters"][long_id] = data["parameters"].delete("opacity")
          data["groups"][0]["parameters"].map! { |id| id == "opacity" ? long_id : id }
          data["regions"][long_id] = data["regions"].delete("filled")
          data["targets"]["filled"] = [long_id]
        }
      )
      assert_equal(true, command(@cli, "verify", long_pdf).status.success?)
      write("inputs.json", {"book" => long_pdf.to_s})
      plan = {
        "version" => 1,
        "sources" => {"a" => {"input" => "book", "overrides" => {}}, "b" => {"input" => "book", "overrides" => {}}},
        "parts" => [{"pages" => [{"source" => "a", "page" => 0}, {"source" => "b", "page" => 0}]}]
      }
      composed_long, _ = compose(plan, "long-ids-composed.pdf")
      assert_equal(true, command(@cli, "verify", composed_long).status.success?)

      styled_zero = file("styled-neg-zero.pdf")
      FileUtils.rm_f(styled_zero)
      write("neg-zero.json", {"opacity" => -0.0})
      assert_equal(
        true,
        command(@cli, "style", tagged, "--overrides", file("neg-zero.json"), "--output", styled_zero).status.success?
      )
      attachment = command("qpdf", "--show-attachment=mainz.json", styled_zero).stdout
      refute_includes(attachment, "-0")
      described_zero = command(@cli, "describe", styled_zero).stdout
      refute_includes(described_zero, "-0")
      assert_equal(0, JSON.parse(described_zero).dig("parameters", "opacity", "parameter", "value"))
      _, zero_records, = snapshot(styled_zero)
      zero_records.each do |_, scope, state|
        refute_match(/(?<![0-9])-0(?:\.0+)?\b/, scope)
        %w[/ca /CA].each do |channel|
          next unless state.key?(channel)

          assert_operator(state[channel], :>=, 0)
        end
      end

      unicode_blank = file("unicode-blank-profile.pdf")
      fixture(
        unicode_blank,
        -> (data) {
          profile_fixture(data)
          data["profileSets"][0]["name"] = "\u00a0\u3000"
        },
        pdf_objects: method(:across_page_objects)
      )
      assert_equal("invalid-contract", failure_code(unicode_blank))
    end

    def test_malformed_pdf_structures_fail_with_pdf_syntax
      truncated = file("truncated.pdf")
      truncated.binwrite("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
      assert_equal("pdf-syntax", failure_code(truncated))

      corrupt_xref = file("corrupt-xref.pdf")
      corrupt_xref.binwrite(
        "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\nxref\n0 2\nnot-a-valid-xref-entry\ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n56\n%%EOF\n"
      )
      assert_equal("pdf-syntax", failure_code(corrupt_xref))

      cyclic = file("cyclic-pages.pdf")
      fixture(
        cyclic,
        pdf_objects: -> (objects, _stream) {
          objects[1] = "<< /Type /Pages /Kids [2 0 R] /Count 1 >>"
          objects[2] = "<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>"
        }
      )
      assert_equal("pdf-syntax", failure_code(cyclic))

      bad_flate = file("bad-flate.pdf")
      garbage = "not valid zlib data at all"
      fixture(
        bad_flate,
        pdf_objects: -> (objects, _stream) {
          objects[4] = "<< /Filter /FlateDecode /Length #{garbage.bytesize} >>\nstream\n#{garbage}\nendstream"
        }
      )
      assert_equal("pdf-syntax", failure_code(bad_flate))
    end
  end
end
