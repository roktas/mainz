# frozen_string_literal: true

require_relative "contract_helper"

module Mainz
  class ContractPreviewTest < Minitest::Test
    include ContractHelper

    def test_previews_survive_shared_pages_and_independent_sources
      source = file("preview.pdf")
      preview_fixture(source)
      assert_equal({"file" => "page.png", "width" => 1, "height" => 1}, describe(source)["pages"][0]["preview"])
      assert_equal(preview_png, command("qpdf", "--show-attachment=page.png", source).stdout)
      unchanged = operation(source, "preview-unchanged.pdf", {"opacity" => 0.15})
      assert_equal(source.binread, unchanged.binread)
      changed = operation(source, "preview-changed.pdf", {"opacity" => 0.4})
      refute(describe(changed)["pages"][0].key?("preview"))
      assert(describe(changed)["pages"][1].key?("preview"))
      assert_equal(preview_png, command("qpdf", "--show-attachment=page.png", changed).stdout)
      discarded = extract(changed, "preview-discarded.pdf", [0])
      refute_includes(command("qpdf", "--list-attachments", discarded).stdout, "page.png")
      retained = extract(source, "preview-retained.pdf", [1])
      assert_equal({}, describe(retained)["parameters"])
      assert_equal(preview_png, command("qpdf", "--show-attachment=page.png", retained).stdout)
      command(@cli, "verify", retained)
      write("inputs.json", {"input" => source.to_s})
      request = {
        "version" => 1,
        "sources" => {
          "changed" => {"input" => "input", "overrides" => {}},
          "saved" => {"input" => "input", "overrides" => {"opacity" => 0.15}}
        },
        "parts" => [{"pages" => %w[changed saved].map { {"source" => it, "page" => 0} }}]
      }
      composed, = compose(request, "preview-composed.pdf")
      pages = describe(composed)["pages"]
      refute(pages[0].key?("preview"))
      assert_equal("page.png", pages[1]["preview"]["file"])
      request["sources"]["saved"]["input"] = "other"
      write("inputs.json", {"input" => source.to_s, "other" => source.to_s})
      composed, = compose(request, "preview-multiple-inputs.pdf")
      image = describe(composed)["pages"][1]["preview"]["file"]
      assert_equal("i1:page.png", image)
      assert_equal(preview_png, command("qpdf", "--show-attachment=#{image}", composed).stdout)
    end

    def test_preview_payloads_above_retention_limit_remain_valid
      source = large_preview_fixture
      assert_equal({"file" => "page.png", "width" => 1, "height" => 1}, describe(source)["pages"][0]["preview"])
    end

    def test_preview_invalidation_follows_parameter_scope
      source = scoped_preview_fixture
      assert_equal([0], describe(source)["parameters"]["opacity"]["pages"])
      edited = operation(source, "preview-scope-edited.pdf", {"opacity" => 0.4})
      assert_equal([false, true], describe(edited)["pages"].map { it.key?("preview") })
      reset = operation(source, "preview-scope-reset.pdf", ["opacity"], reset: true)
      assert_equal([false, true], describe(reset)["pages"].map { it.key?("preview") })
      write("inputs.json", {"input" => source.to_s})
      composed, = compose(
        {
          "version" => 1,
          "sources" => {"source" => {"input" => "input", "overrides" => {}}},
          "parts" => [{"pages" => [0, 1].map { {"source" => "source", "page" => it} }}]
        },
        "preview-scope-composed.pdf"
      )
      assert_equal([false, true], describe(composed)["pages"].map { it.key?("preview") })
    end

    def test_preview_cleanup_preserves_other_pdf_references
      source = file("preview-associated.pdf")
      preview_fixture(source) do |document|
        document.catalog[:AF] = [document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("page.png")]
      end

      changed = operation(source, "preview-associated-changed.pdf", {"opacity" => 0.4})
      discarded = extract(changed, "preview-associated-retained.pdf", [0])
      refute(describe(discarded)["pages"][0].key?("preview"))
      assert_equal(preview_png, command("qpdf", "--show-attachment=page.png", discarded).stdout)
    end

    def test_preview_cleanup_handles_dense_shared_graphs
      source, changed = dense_preview_fixture
      discarded = extract(changed, "preview-dense-extracted.pdf", [0])
      refute(describe(discarded)["pages"][0].key?("preview"))
      assert_equal(130_000, HexaPDF::Document.open(discarded.to_s).catalog[:Dense].length)
      assert_equal(preview_png, command("qpdf", "--show-attachment=page.png", discarded).stdout)
      assert_equal(Preservation.read(source), Preservation.read(changed))
    end

    def test_preview_cleanup_rejects_excessive_reference_fanout
      changed = fanout_preview_fixture
      original = changed.binread
      output = file("preview-fanout-extracted.pdf")
      FileUtils.rm_f(output)
      failure = command(@cli, "extract", changed, "--pages", write("request.json", [0]), "--output", output, ok: false)
      assert_equal("limit-exceeded", JSON.parse(failure.stderr)["code"])
      refute_path_exists(output)
      assert_equal(original, changed.binread)
    end

    def test_preview_references_validate_attachment_identity
      [
        -> (document) { document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("page.png")[:UF] = "other.png" },
        -> (document) {
          document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("page.png")[:EF][:F][:Subtype] = :Image
        },
        -> (document) { document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("page.png")[:EF][:UF] = nil }
      ].each_with_index do |mutation, index|
        source = file("preview-invalid-reference-#{index}.pdf")
        preview_fixture(source, &mutation)
        assert_equal("invalid-contract", failure_code(source))
      end

      source = file("preview-missing-reference.pdf")
      fixture(source, -> (manifest) { manifest["pages"][0] = {"preview" => "missing.png"} })
      assert_equal("invalid-contract", failure_code(source))
    end

    def test_optional_display_preserves_original_visibility
      source, original = fixed_visibility_fixture
      command(@cli, "verify", source)
      parameters = describe(source).fetch("parameters")
      assert_equal(original.fetch("parameters").keys.sort, parameters.keys.sort)
      changes = {"width" => 0.2, "guide-fill" => 0.4, "fill-color" => "#00FF00"}
      edited = operation(source, "fixed-visibility-edited.pdf", changes)
      manifest, records = snapshot(edited)
      assert_equal(original.fetch("baselines"), manifest.fetch("baselines"))
      hidden = records.find { |baseline, _, _| baseline == "hidden" }[2]
      assert_equal(0, hidden.fetch("/CA"))
      assert_equal(0, hidden.fetch("/ca"))
      changes.each do |id, value|
        assert_equal(value, describe(edited).fetch("parameters").fetch(id).fetch("parameter").fetch("value"))
      end

      restored = operation(edited, "fixed-visibility-reset.pdf", reset: true)
      extracted = extract(source, "fixed-visibility-extracted.pdf", [0])
      write("inputs.json", {"input" => source.to_s})
      composed, = compose(plan, "fixed-visibility-composed.pdf")
      [edited, restored, extracted, composed].each do |path|
        command(@cli, "verify", path)
        summary = describe(path)
        refute(
          summary.fetch("parameters").values.any? { |entry| entry["parameter"]["binding"]["property"] == "display" }
        )
        retained = JSON.parse(command("qpdf", "--show-attachment=mainz.json", path).stdout)
        assert_includes(retained.fetch("baselines").values.map { |baseline| baseline.fetch("display") }, "none")
      end
    end

    def test_alpha_resources_validate_each_paint_scope
      source = file("scope-alpha.pdf")
      [1, 0.25].each do |alpha|
        alpha_fixture(source, alpha)
        if alpha == 1
          command(@cli, "verify", source)
        else
          assert_equal("invalid-contract", failure_code(source))
        end
      end
    end

    def test_unused_resource_maps_require_dictionaries
      [[5, "ExtGState"], [6, "XObject"]].each do |index, key|
        source = file("invalid-resources.pdf")
        resources_fixture(source, index, key)
        assert_equal("invalid-contract", failure_code(source))
      end
    end

    def test_image_xobject_does_not_block_alpha_resource_pruning
      source = file("image-xobject-pruning.pdf")
      fixture(
        source,
        pdf_objects: -> (objects, stream) {
          objects << stream.call(
            "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8",
            "\x00"
          )
          objects[2] = objects[2].sub("/Row 6 0 R", "/Row 6 0 R /Pic 15 0 R")
          objects[4] = objects[4].sub("\nendstream", "\nq /Pic Do Q\nendstream")
        }
      )
      first = operation(source, "image-alpha-1.pdf", {"guide-display" => "inline", "guide-fill" => 0.5})
      second = operation(first, "image-alpha-2.pdf", {"guide-fill" => 0.8})
      third = operation(second, "image-alpha-3.pdf", {"guide-fill" => 0.3})
      alpha_keys = -> (path) {
        pdf = pdf_json(path)
        objects = pdf["qpdf"][1]
        page = resolve(pdf["pages"][0]["object"], objects)
        states = resolve(resolve(page["/Resources"], objects)["/ExtGState"], objects)
        states.keys.select { |key| key.start_with?("/MainzAlpha") }
      }
      assert_equal(1, alpha_keys.call(first).length)
      assert_equal(1, alpha_keys.call(second).length)
      assert_equal(1, alpha_keys.call(third).length)
      reset = operation(third, "image-alpha-reset.pdf", %w[guide-display guide-fill], reset: true)
      assert_equal(1, alpha_keys.call(reset).length)
    end
  end
end
