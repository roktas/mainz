# frozen_string_literal: true

require "minitest/autorun"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::Preservation)

module Mainz
  class ContractTest < Minitest::Test
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

    def setup
      @directory = Mainz.workspace("tmp/test/lib")
      @cli = File.expand_path(ENV.fetch("MAINZ_CLI"))
      @source = file("prepared.pdf")
      @original = fixture(@source)
      @initial = snapshot(@source)
      write("inputs.json", {"input" => @source.to_s})
      write("job.json", job)
    end

    def teardown
      write("inputs.json", {"input" => @source.to_s})
      write("job.json", job)
    end

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

    def test_shared_baselines_keep_occurrence_specific_widths
      source = file("shared-baseline.pdf")
      fixture(
        source,
        -> (manifest) {
          manifest["regions"]["rows"]["records"][1]["baseline"] = "dark"
          manifest["baselines"].delete("dim")
        }
      )
      description = describe(source)
      assert_equal({"kind" => "mixed"}, description["parameters"]["width"]["baseline"])
      assert_equal({"kind" => "uniform", "value" => 1}, description["parameters"]["opacity"]["baseline"])
      edited = operation(source, "shared-baseline-edited.pdf", {"width" => 0.2})
      widths = snapshot(edited)[1].filter_map { |baseline, scope, _|
        scope[/q\s+([^ ]+) w/, 1].to_f if baseline == "dark"
      }
      assert_equal(2, widths.length)
      widths.zip([0.28346456692913385, 0.14173228346456693]).each { |actual, expected|
        assert_in_delta(expected, actual, 1e-15)
      }
    end

    def test_styling_and_reset_preserve_immutable_baselines
      edited, records, = snapshot(styled)
      records.each do |baseline, scope, state|
        if %w[dark dim].include?(baseline)
          expected = baseline == "dark" ? 0.28346456692913385 : 0.14173228346456693
          assert_in_delta(expected, scope[/q\s+([^ ]+) w/, 1].to_f, 1e-15)
          assert_equal(0.65, state["/CA"])
          assert_includes(scope, "10.12345678901234567890123456789")
        elsif baseline == "hidden"
          assert_includes(scope, "B* Q")
          assert_equal(0.4, state["/ca"])
        elsif baseline == "filled"
          assert_includes(scope, "f* Q")
          assert_equal(0.2, state["/ca"])
        end
      end

      assert_equal(@original["baselines"], edited["baselines"])
      assert_equal(@original["parameters"]["opacity"]["schema"], edited["parameters"]["opacity"]["schema"])
      hidden = operation(styled, "hidden.pdf", {"display" => "none", "guide-display" => "none"})
      while_hidden = operation(hidden, "while-hidden.pdf", {"opacity" => 0.4, "guide-fill" => 0.7})
      snapshot(while_hidden)[1].each do |baseline, _, state|
        next if baseline == "filled"

        assert_equal(0, state["/CA"])
        assert_equal(0, state["/ca"])
      end

      shown = operation(while_hidden, "shown.pdf", {"display" => "inline", "guide-display" => "inline"})
      paint = snapshot(shown)[1]
      assert_equal(
        [0.4, 0.4],
        paint.filter_map { |baseline, _, state| state["/CA"] if %w[dark dim].include?(baseline) }
      )
      assert_equal(0.7, paint.find { |baseline, _, _| baseline == "hidden" }[2]["/ca"])
      selective = operation(shown, "selective.pdf", ["opacity"], reset: true)
      assert_equal(
        [1, 0.25],
        snapshot(selective)[1].filter_map { |baseline, _, state| state["/CA"] if %w[dark dim].include?(baseline) }
      )
      reset = operation(selective, "reset.pdf", reset: true)
      manifest, paint, = snapshot(reset)
      assert(manifest["parameters"].values.none? { |parameter| parameter.key?("value") })
      paint.each { |_, scope, _| assert_includes(scope, "+.2000000000000000000 w") }
      guide = paint.find { |baseline, _, _| baseline == "hidden" }
      assert_equal(0, guide[2]["/CA"])
      assert(guide[1].strip.end_with?("S Q"))
    end

    def test_large_legal_manifests_remain_editable
      source = file("large-manifest.pdf")
      fixture(
        source,
        -> (manifest) { manifest["groups"] = Array.new(251) { {"title" => "x" * 4096, "parameters" => []} } }
      )
      edited = operation(source, "large-manifest-edited.pdf", {"opacity" => 0.65})
      assert_equal(251, describe(edited)["groups"].length)
    end

    def test_dense_descriptions_remain_editable
      source = file("dense-manifest.pdf")
      fixture(
        source,
        -> (manifest) { manifest["groups"] = Array.new(17_000) { {"title" => "x", "parameters" => []} } }
      )
      edited = operation(source, "dense-manifest-edited.pdf", {"opacity" => 0.65})
      assert_equal(17_000, describe(edited)["groups"].length)
      assert_equal(0.65, describe(edited)["parameters"]["opacity"]["parameter"]["value"])
    end

    def test_baseline_summaries_retain_numeric_precision
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

    def test_noops_and_repeated_choices_preserve_bytes
      empty = operation(@source, "empty.pdf", {})
      empty_reset = operation(@source, "empty-reset.pdf", [], reset: true)
      assert_equal(@source.binread, empty.binread)
      assert_equal(@source.binread, empty_reset.binread)
      pristine = operation(@source, "pristine-reset.pdf", reset: true)
      assert_equal(pristine.binread, operation(pristine, "pristine-reset-again.pdf", reset: true).binread)
      assert_equal(styled.binread, operation(styled, "unchanged-choice.pdf", {"opacity" => 0.65}).binread)
      assert_equal(styled.binread, operation(styled, "unused-reset.pdf", ["display"], reset: true).binread)
      choice = operation(@source, "equal-choice.pdf", {"color" => "#333333"})
      assert_equal("#333333", snapshot(choice)[0]["parameters"]["color"]["value"])
      reset = operation(choice, "equal-choice-reset.pdf", ["color"], reset: true)
      refute(snapshot(reset)[0]["parameters"]["color"].key?("value"))
      assert_equal(styled.binread, operation(@source, "deterministic.pdf", CHOICES).binread)
      assert_equal(page_two(@initial), page_two(snapshot(styled)))
    end

    def test_invalid_style_requests_preserve_existing_output
      protected = file("protected.pdf")
      protected.binwrite("existing output")
      [
        "null",
        "[]",
        "{\"opacity\":null}",
        "{\"unknown\":0.2}",
        "{\"opacity\":2}",
        "{\"opacity\":0.2,\"opaci\\u0074y\":0.4}",
        "{\"color\":\"red\"}",
        "{\"width\":0}",
        "{\"opacity\":1e999}",
        "{\"opacity\":\"\\ud800\"}",
        "\uFEFF{}"
      ].each do |request|
        file("invalid.json").write(request)
        failure = command(@cli, "apply", @source, "--request", file("invalid.json"), "--output", protected, ok: false)
        error = JSON.parse(failure.stderr)
        assert_equal("invalid-request", error["code"])
        assert_equal("request", error["source"])
        assert_equal("existing output", protected.binread)
      end

      file("invalid.json").write("[\"opacity\",\"opacity\"]")
      command(@cli, "reset", @source, "--ids", file("invalid.json"), "--output", protected, ok: false)
      assert_empty(@directory.glob(".mainz-*"))
    end

    def test_error_context_does_not_use_request_string_limits
      id = "x" * 4096
      request = write("long-unknown-id.json", {id => 0.2})
      failure = command(@cli, "apply", @source, "--request", request, "--output", file("long-id.pdf"), ok: false)
      error = JSON.parse(failure.stderr)
      assert_equal("invalid-request", error["code"])
      assert_equal("request", error["source"])
      assert_equal("/#{id}", error["location"])

      source = file("long-unknown-field.pdf")
      fixture(source, -> (manifest) { manifest[id] = true })
      failure = command(@cli, "verify", source, ok: false)
      error = JSON.parse(failure.stderr)
      assert_equal("invalid-contract", error["code"])
      assert_equal("manifest", error["source"])
    end

    def test_invalid_manifests_and_numeric_tokens_are_rejected
      mutations = [
        -> (m) { m["extra"] = true },
        -> (m) { m["parameters"]["opacity"]["value"] = nil },
        -> (m) { m["parameters"]["width"]["schema"]["minimum"] = "zero" },
        -> (m) { m["parameters"]["width"]["schema"].merge!("minimum" => 2, "exclusiveMaximum" => 2) },
        -> (m) { m["parameters"]["width"]["schema"]["enum"] = [1, 1.0] },
        -> (m) { m["parameters"]["display"]["schema"]["enum"] = ["inline"] },
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

    def test_opaque_ids_survive_document_operations
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
          %w[pages regions baselines targets parameters].each do |field|
            manifest[field].transform_keys! { it + suffix }
          end

          manifest["regions"].each_value do |region|
            region["page"] += suffix
            region.fetch("records", []).each { it["baseline"] += suffix }
          end

          manifest["targets"].each_value { it.map! { |id| id + suffix } }
          manifest["parameters"].each_value { it["binding"]["targets"].map! { |id| id + suffix } }
          manifest["groups"].each { it["parameters"].map! { |id| id + suffix } }
        }
      )
      assert_equal(0, describe(source)["pages"].fetch("practice#{suffix}")["index"])
      edited = operation(source, "opaque-edited.pdf", {opacity => 0.65})
      assert_equal(0.65, describe(edited)["parameters"].fetch(opacity)["parameter"]["value"])
      selected = extract(edited, "opaque-extracted.pdf", [0])
      restored = operation(selected, "opaque-reset.pdf", [opacity], reset: true)
      refute(describe(restored)["parameters"].fetch(opacity)["parameter"].key?("value"))

      input = "input#{suffix}"
      scope = "source#{suffix}"
      write("inputs.json", {input => source.to_s})
      composed, result = compose(
        {
          "version" => 1,
          "sources" => {scope => {"input" => input, "overrides" => {opacity => 0.4}}},
          "parts" => [{"pages" => [{"source" => scope, "page" => 0}]}]
        },
        "opaque-composed.pdf"
      )
      parameter = JSON.parse(result.stdout)["parameters"].find { |_, entry| entry["parameter"] == opacity }
      assert_equal(scope, parameter.last["source"])
      assert_equal(0.4, describe(composed)["parameters"].fetch(parameter.first)["parameter"]["value"])
    end

    def test_enums_retain_choices_with_a_nonempty_intersection
      source = file("enum-intersection.pdf")
      fixture(source, -> (m) { m["parameters"]["opacity"]["schema"].merge!("enum" => [0.15, 0.9], "maximum" => 0.5) })
      command(@cli, "verify", source)
      fixture(source, -> (m) { m["parameters"]["opacity"]["schema"].merge!("enum" => [0.8, 0.9], "maximum" => 0.5) })
      command(@cli, "verify", source, ok: false)
      colors = ["#333333", *4000.times.map { |index| format("#%06X", index) }]
      fixture(file("enumerated.pdf"), -> (m) { m["parameters"]["color"]["schema"]["enum"] = colors })
      assert_equal(colors, describe(file("enumerated.pdf"))["parameters"]["color"]["parameter"]["schema"]["enum"])
      fixture(file("enumerated.pdf"), -> (m) { m["parameters"]["color"]["schema"]["enum"] = [*colors, colors.last] })
      assert_equal("invalid-contract", failure_code(file("enumerated.pdf")))
    end

    def test_color_baselines_use_a_valid_schema_spelling
      source = file("color-enum.pdf")
      fixture(
        source,
        -> (manifest) {
          %w[dark dim].each do |id|
            manifest["baselines"][id]["stroke"] = {"operator" => "RG", "operands" => %w[1 0 0]}
          end

          manifest["parameters"]["color"]["schema"].merge!("enum" => ["#ff0000"], "default" => "#ff0000")
        },
        pdf_objects: replace_object(6, "0.2 G", "1 0 0 RG")
      )
      assert_equal({"kind" => "uniform", "value" => "#ff0000"}, describe(source)["parameters"]["color"]["baseline"])
    end

    def test_escaped_names_and_inline_images_remain_editable
      source = file("escaped-names.pdf")
      fixture(source, pdf_objects: replace_object(5, "/Shape Do", "/Sh#61pe Do"))
      command(@cli, "verify", operation(source, "escaped-names-edited.pdf", {"color" => "#555555"}))
      inline = file("inline-image.pdf")
      fixture(
        inline,
        pdf_objects: replace_object(4, "\nendstream", "\nq BI /W 1 /H 1 /BPC 8 /CS /G ID 0 EI Q\nendstream")
      )
      command(@cli, "verify", inline)
      edited = operation(inline, "inline-image-edited.pdf", {"color" => "#555555"})
      command(@cli, "verify", edited)
      assert_equal(Preservation.read(inline), Preservation.read(edited))
      ["[1 2", "[1 >>", "12"].each do |tail|
        fixture(file("invalid-content.pdf"), pdf_objects: replace_object(4, "\nendstream", "\n#{tail}\nendstream"))
        assert_equal("pdf-syntax", failure_code(file("invalid-content.pdf")))
      end
    end

    def test_context_and_resource_mismatches_are_rejected
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
      assert_equal("invalid-contract", failure_code(source))
      cases = [
        [
          "unsupported-context",
          replace_object(5, "/BBox", "/Group << /S /Transparency /CS /DeviceRGB /I false >> /BBox")
        ],
        [
          "unsupported-context",
          replace_object(5, "/BBox", "/Group << /S /Transparency /CS /DeviceRGB /I true /K true >> /BBox")
        ],
        [
          "unsupported-context",
          replace_object(6, "/Resources <<", "/Resources << /ColorSpace << /DefaultGray /DeviceRGB >>")
        ],
        ["unsupported-context", replace_object(5, "/Shape Do", "q 2 0 0 1 0 0 cm /Shape Do Q")],
        ["invalid-contract", replace_object(5, "/Shape 7 0 R", "/Shape 6 0 R")],
        ["invalid-contract", replace_object(8, "/F (mainz.json)", "/F (wrong.json)")],
        ["unsupported-context", replace_object(0, "/Names", "/Perms << /DocMDP 9 0 R >> /Names")]
      ]
      cases.each_with_index do |(code, mutation), index|
        source = file("unsupported-#{index}.pdf")
        fixture(source, pdf_objects: mutation)
        assert_equal(code, failure_code(source))
      end

      encrypted = file("encrypted.pdf")
      FileUtils.rm_f(encrypted)
      command("qpdf", "--encrypt", "", "owner", "256", "--", @source, encrypted)
      assert_equal("unsupported-context", failure_code(encrypted))
    end

    def test_latent_fills_require_closed_nonoverlapping_subpaths
      rectangle = "10 100 40 40 re 20 110 20 20 re"
      [
        replace_object(4, "\nendstream", "\n#{rectangle} f\nendstream"),
        replace_object(4, rectangle, "10 100 m 50 100 l"),
        replace_object(4, rectangle, "10 100 40 40 re 20 110 m 30 110 l")
      ].each do |mutation|
        fixture(file("invalid-fill.pdf"), pdf_objects: mutation)
        assert_equal("invalid-contract", failure_code(file("invalid-fill.pdf")))
      end

      [" 10 100 m", " 10 100 m 20 110 m"].each do |suffix|
        fixture(file("empty-moves.pdf"), pdf_objects: replace_object(4, rectangle, rectangle + suffix))
        command(@cli, "verify", file("empty-moves.pdf"))
        command(@cli, "verify", operation(file("empty-moves.pdf"), "empty-moves-edited.pdf", {"guide-fill" => 0.6}))
      end

      fixture(
        file("duplicate-empty-moves.pdf"),
        pdf_objects: -> (objects, stream) {
          replace_object(4, rectangle, rectangle + " 10 100 m").call(objects, stream)
          replace_object(4, "\nendstream", "\n#{rectangle} f\nendstream").call(objects, stream)
        }
      )
      assert_equal("invalid-contract", failure_code(file("duplicate-empty-moves.pdf")))
      fixture(
        file("implicit-after-empty.pdf"),
        -> (m) { m["baselines"]["hidden"]["paint"] = "s" },
        pdf_objects: replace_object(4, rectangle + " S", "10 100 m 20 110 l 30 110 m s")
      )
      assert_equal("invalid-contract", failure_code(file("implicit-after-empty.pdf")))
    end

    def test_duplicate_fills_ignore_numeric_spelling
      source = file("duplicate-fill-spelling.pdf")
      fixture(
        source,
        pdf_objects: replace_object(
          4,
          "\nendstream",
          "\n+010.0 00100.00 040.000 40. re 20.0 +110 0020 20.00 re f\nendstream"
        )
      )
      assert_equal("invalid-contract", failure_code(source))
      fixture(
        file("distinct-fill-spelling.pdf"),
        pdf_objects: replace_object(
          4,
          "\nendstream",
          "\n10.000000000000000000000001 100 40 40 re 20 110 20 20 re f\nendstream"
        )
      )
      command(@cli, "verify", file("distinct-fill-spelling.pdf"))
    end

    def test_decoded_content_and_manifest_limits_are_enforced
      fixture(
        file("decode-limit.pdf"),
        pdf_objects: -> (objects, stream) {
          objects[4] = stream.call("/Filter /FlateDecode", Zlib::Deflate.deflate(" " * (32 * 1024 * 1024 + 1)))
        }
      )
      assert_equal("limit-exceeded", failure_code(file("decode-limit.pdf")))
      fixture(file("book-json.pdf"), pdf_objects: padded_manifest(1024 * 1024 + 1))
      command(@cli, "verify", file("book-json.pdf"))
      fixture(file("manifest-limit.pdf"), pdf_objects: padded_manifest(8 * 1024 * 1024 + 1))
      assert_equal("limit-exceeded", failure_code(file("manifest-limit.pdf")))
    end

    def test_repeated_edits_bound_object_growth
      current = styled
      sizes = 12.times.map do |index|
        current = operation(current, "repeat-#{index}.pdf", {"opacity" => index.odd? ? 0.3 : 0.7})
        snapshot(current)[2].length
      end

      assert_operator(sizes.max - sizes.min, :<=, 2)
    end

    def test_styling_preserves_content_and_reset_appearance
      reset = operation(styled, "reset.pdf", reset: true)
      baseline = file("baseline.pdf")
      fixture(baseline, authored_baseline: true)
      expected = Preservation.read(@source)
      assert_equal(expected, Preservation.read(styled))
      assert_equal(expected, Preservation.read(reset))
      assert_equal(
        [1, 0.25],
        snapshot(reset)[1].filter_map { |id, _, state| state["/CA"] if %w[dark dim].include?(id) }
      )
      [150, 300].each do |dpi|
        [@source, styled, reset, baseline].each { |candidate| raster(candidate, dpi) }
        assert_raster("prepared-#{dpi}-2.png", "edited-#{dpi}-2.png")
        assert_raster("prepared-#{dpi}-2.png", "reset-#{dpi}-2.png")
        assert_raster("baseline-#{dpi}-1.png", "reset-#{dpi}-1.png")
      end
    end

    def test_extraction_preserves_content_and_rebuilds_the_contract
      one = extract(styled, "extracted.pdf", [0])
      pristine = extract(@source, "extracted-pristine.pdf", [0])
      command(@cli, "verify", one)
      assert_equal(1, describe(one)["pageCount"])
      assert_equal(snapshot(styled)[0], snapshot(one)[0])
      assert_equal(page_snapshot(styled, 0), page_snapshot(one, 0))
      one_reset = operation(one, "extracted-reset.pdf", reset: true)
      reset = operation(styled, "reset.pdf", reset: true)
      assert_equal(snapshot(reset)[1].map(&:last), snapshot(one_reset)[1].map(&:last))
      expected = Preservation.read(pristine)
      assert_equal(expected, Preservation.read(one))
      assert_equal(expected, Preservation.read(one_reset))
      assert_equal(@source.binread, extract(@source, "extracted-all.pdf", [0, 1]).binread)
      reverse = extract(@source, "extracted-reverse.pdf", [1, 0])
      assert_equal(1, describe(reverse)["pages"]["practice"]["index"])
      assert_equal(page_snapshot(@source, 1), page_snapshot(reverse, 0))
      assert_equal(page_snapshot(@source, 0), page_snapshot(reverse, 1))
      cover = extract(@source, "extracted-ordinary.pdf", [1])
      command("qpdf", "--check", cover)
      assert_equal(page_snapshot(@source, 1), page_snapshot(cover, 0))
      assert_equal("missing-contract", failure_code(cover))
      refute_includes(command("qpdf", "--list-attachments", cover).stdout, "mainz.json")
      assert_equal("Unrelated attachment.\n", command("qpdf", "--show-attachment=notes.txt", cover).stdout)
      assert_equal({"version" => 1, "pageCount" => 1, "pages" => {}, "parameters" => {}}, describe(cover))
      assert_equal(cover.binread, extract(cover, "ordinary-all.pdf", [0]).binread)
      ordinary_request = write("ordinary-request.json", {})
      [["apply", ["--request", ordinary_request]], ["reset", []]].each do |operation, options|
        failure = command(@cli, operation, cover, *options, "--output", file("ordinary-style.pdf"), ok: false)
        assert_equal("missing-contract", JSON.parse(failure.stderr)["code"])
      end

      ordinary = file("ordinary.pdf")
      command("qpdf", @source, "--remove-attachment=mainz.json", "--", ordinary)
      assert_equal(2, describe(ordinary)["pageCount"])
      reverse = extract(ordinary, "ordinary-reverse.pdf", [1, 0])
      assert_equal(page_snapshot(ordinary, 1), page_snapshot(reverse, 0))
      assert_equal(page_snapshot(ordinary, 0), page_snapshot(reverse, 1))
      assert_equal("Unrelated attachment.\n", command("qpdf", "--show-attachment=notes.txt", reverse).stdout)
      ordinary_one = extract(reverse, "ordinary-one.pdf", [1])
      assert_equal(page_snapshot(ordinary, 0), page_snapshot(ordinary_one, 0))
      assert_empty(describe(ordinary_one)["parameters"])
      fixture(file("extraction-associated.pdf"), pdf_objects: replace_object(0, "/Names", "/AF [9 0 R 13 0 R] /Names"))
      associated = extract(file("extraction-associated.pdf"), "extracted-associated.pdf", [1])
      pdf = pdf_json(associated)
      objects = pdf["qpdf"][1]
      root = resolve(objects["trailer"]["value"]["/Root"], objects)
      assert_equal(1, root["/AF"].length)
      assert_equal("u:notes.txt", resolve(root["/AF"][0], objects)["/F"])
      fixture(file("baseline.pdf"), authored_baseline: true)
      [150, 300].each do |dpi|
        [styled, @source, file("baseline.pdf"), one, cover, one_reset].each { |candidate| raster(candidate, dpi) }
        assert_raster("edited-#{dpi}-1.png", "extracted-#{dpi}-1.png")
        assert_raster("prepared-#{dpi}-2.png", "extracted-ordinary-#{dpi}-1.png")
        assert_raster("baseline-#{dpi}-1.png", "extracted-reset-#{dpi}-1.png")
      end
    end

    def test_extraction_prunes_navigation_and_retains_form_fields
      source = file("extraction-navigation.pdf")
      fixture(source, pdf_objects: method(:page_navigation))
      [[[0], "selected"], [[1], "ordinary"], [[1, 0], "reverse"]].each do |selection, name|
        destination = extract(source, "extracted-navigation-#{name}.pdf", selection)
        pdf = pdf_json(destination)
        objects = pdf["qpdf"][1]
        root = resolve(objects["trailer"]["value"]["/Root"], objects)
        fields = root["/AcroForm"]["/Fields"].map { |item| resolve(item, objects)["/T"] }
        assert_equal(
          %w[u:Keep u:Remove].each_with_index.filter_map { |title, index| title if selection.include?(index) },
          fields
        )
        destinations = root["/Names"]["/Dests"]["/Names"].each_slice(2).to_h
        %w[u:keep u:remove].each_with_index do |key, index|
          if selection.include?(index)
            assert_equal(pdf["pages"][selection.index(index)]["object"], destinations[key][0])
          else
            assert_nil(resolve(destinations[key][0], objects))
          end
        end

        assert_equal(destinations["u:keep"][0], root["/OpenAction"][0])
      end

      source = file("nested-fields.pdf")
      fixture(source, pdf_objects: method(:nested_fields))
      [[0], [1], [1, 0]].each do |selection|
        destination = extract(source, "extracted-nested-fields.pdf", selection)
        pdf = pdf_json(destination)
        objects = pdf["qpdf"][1]
        form = resolve(objects["trailer"]["value"]["/Root"], objects)["/AcroForm"]
        parent = resolve(form["/Fields"][0], objects)
        assert_equal("u:Group", parent["/T"])
        assert_equal("/Tx", parent["/FT"])
        expected = %w[u:Keep u:Remove].each_with_index.filter_map { |title, index| title if selection.include?(index) }
        assert_equal(expected, parent["/Kids"].map { |child| resolve(child, objects)["/T"] })
        expected = [[1, "u:Remove"], [0, "u:Keep"]].filter_map { |index, title| title if selection.include?(index) }
        assert_equal(expected, form["/CO"].map { |field| resolve(field, objects)["/T"] })
        pdf["pages"].each do |page|
          widget = resolve(resolve(page["object"], objects)["/Annots"][0], objects)
          assert_equal(page["object"], widget["/P"])
        end

        command("qpdf", "--check", destination)
      end
    end

    def test_extraction_prunes_bindings_and_keeps_page_labels
      source = file("extraction-pages.pdf")
      manifest = fixture(source, method(:across_pages), pdf_objects: method(:across_page_objects))
      command(@cli, "verify", source)
      assert_equal("Practice-i", describe(source)["pages"]["practice"]["label"])
      pruned = extract(source, "extracted-pruned.pdf", [0])
      assert_equal("Practice-i", describe(pruned)["pages"]["practice"]["label"])
      actual = snapshot(pruned)[0]
      assert_equal(%w[filled rows], actual["regions"].keys.sort)
      assert_equal(%w[dark dim filled], actual["baselines"].keys.sort)
      assert_equal(["rows"], actual["targets"]["pattern"])
      assert_equal((manifest["parameters"].keys - %w[guide-fill guide-color]).sort, actual["parameters"].keys.sort)
      assert_equal(manifest["parameters"]["opacity"], actual["parameters"]["opacity"])
      assert_equal([manifest["groups"].first], actual["groups"])
      assert_equal(page_snapshot(source, 0), page_snapshot(pruned, 0))
      notes = extract(source, "extracted-notes.pdf", [1])
      assert_equal({"notes" => {"index" => 0, "label" => "Practice-7"}}, describe(notes)["pages"])
      assert_equal(page_snapshot(source, 1), page_snapshot(notes, 0))
      command(@cli, "verify", operation(notes, "extracted-notes-reset.pdf", reset: true))
    end

    def test_invalid_page_selections_preserve_existing_output
      protected = file("protected.pdf")
      protected.binwrite("existing output")
      [
        ["[]", ""],
        ["{}", ""],
        ["[0,0]", "/1"],
        ["[-1]", "/0"],
        ["[2]", "/0"],
        ["[0.5]", "/0"],
        ["[\"0\"]", "/0"],
        ["[null]", "/0"]
      ].each do |request, location|
        file("invalid.json").write(request)
        failure = command(@cli, "extract", @source, "--pages", file("invalid.json"), "--output", protected, ok: false)
        record = JSON.parse(failure.stderr)
        assert_equal("invalid-request", record["code"])
        assert_equal("request", record["source"])
        assert_equal(location, record["location"])
        assert_equal("existing output", protected.binread)
      end

      assert_equal(@source.binread, extract(@source, "extracted-all.pdf", [0, 1]).binread)
    end

    def test_composition_isolates_source_styles_and_reports_padding
      composed, result = compose(job)
      report = JSON.parse(result.stdout)
      assert_equal(10, report["pages"].length)
      assert_equal(
        {"part" => 1, "copy" => 0, "blank" => {"width" => 127, "height" => 127}, "padding" => true},
        report["pages"][1]
      )
      assert_equal(
        {"part" => 1, "copy" => 0, "blank" => {"width" => 210, "height" => 297}, "padding" => true},
        report["pages"][5]
      )
      assert(report["pages"][9]["padding"])
      assert_equal(1, report["pages"][9]["copy"])
      command("qpdf", "--check", composed)
      description = describe(composed)
      assert_equal(10, description["pageCount"])
      assert_equal(
        [@original["groups"][0]["description"]] * 2,
        description["groups"].map { |group| group["description"] }
      )
      identities = report["parameters"].to_h { |id, value| [[value["source"], value["parameter"]], id] }
      refute(description["parameters"][identities[["baseline", "opacity"]]]["parameter"].key?("value"))
      assert_equal(0.65, description["parameters"][identities[["edited", "opacity"]]]["parameter"]["value"])
      assert_equal(2, description["parameters"][identities[["baseline", "opacity"]]]["pages"].length)
      assert_equal(page_snapshot(@source, 1), page_snapshot(composed, 0))
      assert_equal(page_snapshot(composed, 2), page_snapshot(composed, 6))
      assert_equal(page_snapshot(composed, 3), page_snapshot(composed, 7))
      reset = operation(composed, "composed-reset.pdf", reset: true)
      [150, 300].each do |dpi|
        command("pdftoppm", "-f", 3, "-l", 8, "-r", dpi, "-png", reset, file("composed-reset-#{dpi}"))
        [4, 7, 8].each { |page|
          assert_raster("composed-reset-#{dpi}-03.png", format("composed-reset-%d-%02d.png", dpi, page))
        }
      end

      assert_equal("Unrelated attachment.\n", command("qpdf", "--show-attachment=notes.txt", composed).stdout)
      file("composition-report.json").binwrite(result.stdout)
    end

    def test_composition_keeps_page_geometry_and_sizes_padding
      source = file("extraction-pages.pdf")
      fixture(source, method(:across_pages), pdf_objects: method(:across_page_objects))
      write("inputs.json", {"input" => source.to_s})
      cropped, result = compose(
        {
          "version" => 1,
          "sources" => {"crop" => {"input" => "input", "overrides" => {}}},
          "parts" => [{"pages" => [{"source" => "crop", "page" => 0}], "front" => true}]
        },
        "composed-crop.pdf"
      )
      padding = JSON.parse(result.stdout)["pages"][1]["blank"]
      assert_in_delta(320 * 2 * 25.4 / 72, padding["width"], 1e-9)
      assert_in_delta(340 * 2 * 25.4 / 72, padding["height"], 1e-9)
      original = page_snapshot(source, 0)
      copied = page_snapshot(cropped, 0)
      %w[/MediaBox /CropBox /TrimBox /Rotate /UserUnit].each { |key| assert_equal(original[key], copied[key]) }
      page_snapshot(cropped, 1)["/MediaBox"].zip([0, 0, 640, 680]).each { |actual, expected|
        assert_in_delta(expected, actual, 1e-9)
      }
    end

    def test_composition_rejects_invalid_jobs_and_identifiers
      invalids = [
        job.merge("version" => 2),
        job.merge("extra" => true),
        job.merge("parts" => [{"pages" => [{"source" => "baseline", "page" => 99}]}]),
        job.merge("parts" => [{"pages" => [{"source" => "baseline", "page" => 0}], "copies" => 1001}]),
        job.merge("sources" => job["sources"].merge("edited" => {"input" => "input", "overrides" => {"opacity" => 2}})),
        {"version" => 1, "sources" => {}, "parts" => [{"pages" => [{"blank" => {"width" => 0, "height" => 10}}]}]}
      ]
      invalids.each do |invalid|
        _, failure = compose(invalid, "composition-failure.pdf", ok: false)
        error = JSON.parse(failure.stderr)
        assert_includes(%w[invalid-request unsupported-version], error["code"])
        assert_equal("request", error["source"])
      end

      ["", "bad\nID", "bad\u007FID", "bad\u0085ID", "bad\u009FID"].each do |id|
        invalid = {
          "version" => 1,
          "sources" => {id => {"input" => "input", "overrides" => {}}},
          "parts" => [{"pages" => [{"source" => id, "page" => 0}]}]
        }
        _, failure = compose(invalid, "invalid-source-id.pdf", ok: false)
        assert_equal("invalid-request", JSON.parse(failure.stderr)["code"])
        write("inputs.json", {id => @source.to_s})
        invalid["sources"] = {"source" => {"input" => id, "overrides" => {}}}
        invalid["parts"] = [{"pages" => [{"source" => "source", "page" => 0}]}]
        _, failure = compose(invalid, "invalid-input-id.pdf", ok: false)
        assert_equal("invalid-request", JSON.parse(failure.stderr)["code"])
        write("inputs.json", {"input" => @source.to_s})
      end
    end

    def test_blank_composition_obeys_geometry_and_page_limits
      blank = {
        "version" => 1,
        "sources" => {},
        "parts" => [{"pages" => [{"blank" => {"width" => 210, "height" => 297}}], "copies" => 3, "front" => true}]
      }
      write("inputs.json", {})
      output, result = compose(blank, "composed-blanks.pdf")
      assert_equal(6, JSON.parse(result.stdout)["pages"].length)
      assert_empty(describe(output)["parameters"])
      _, failure = compose(
        blank.merge("parts" => [{"pages" => [{"blank" => {"width" => 0, "height" => 10}}]}]),
        "bad-blank.pdf",
        ok: false
      )
      assert_equal("/parts/0/pages/0", JSON.parse(failure.stderr)["location"])
      _, failure = compose(
        blank.merge("parts" => [{"pages" => [{"blank" => {"width" => 1, "height" => 1}}] * 11, "copies" => 1000}]),
        "oversized-job.pdf",
        ok: false
      )
      assert_equal("limit-exceeded", JSON.parse(failure.stderr)["code"])
    end

    def test_composition_remaps_links_and_isolates_annotations
      navigation = file("navigation.pdf")
      fixture(
        navigation,
        pdf_objects: -> (objects, _) {
          objects[0] = objects[0].sub("/Type /Catalog", "/Type /Catalog /Dests << /home [3 0 R /Fit] >>")
          objects[2] = objects[2].sub("/Type /Page", "/Type /Page /Annots [15 0 R 16 0 R]")
          objects.concat(
            [
              "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Dest /home >>",
              "<< /Type /Annot /Subtype /Link /Rect [20 0 30 10] /Dest [4 0 R /Fit] >>"
            ]
          )
        }
      )
      ordinary = file("ordinary.pdf")
      command("qpdf", @source, "--remove-attachment=mainz.json", "--", ordinary)
      write("inputs.json", {"one" => navigation.to_s, "two" => ordinary.to_s})
      request = {
        "version" => 1,
        "sources" => {
          "a" => {"input" => "one", "overrides" => {"opacity" => 0.15}},
          "b" => {"input" => "two", "overrides" => {}}
        },
        "parts" => [
          {"pages" => [{"source" => "a", "page" => 0}, {"source" => "a", "page" => 0}, {"source" => "b", "page" => 1}]}
        ]
      }
      output, = compose(request, "composed-navigation.pdf")
      command("qpdf", "--check", output)
      pdf = pdf_json(output)
      objects = pdf["qpdf"][1]
      pages = pdf["pages"].first(2).map { |page| resolve(page["object"], objects) }
      refute_equal(pages[0]["/Annots"], pages[1]["/Annots"])
      pages.each do |page|
        retained, removed = page["/Annots"].map { |annotation| resolve(annotation, objects)["/Dest"] }
        assert_equal(pdf["pages"][0]["object"], retained[0])
        assert_nil(resolve(removed[0], objects))
      end

      %w[i0:notes.txt i1:notes.txt].each do |name|
        assert_equal("Unrelated attachment.\n", command("qpdf", "--show-attachment=#{name}", output).stdout)
      end
    end

    def test_shared_records_isolate_styles_and_retain_baselines
      source = file("shared.pdf")
      fixture(source, method(:shared_regions), pdf_objects: method(:shared_objects))
      command(@cli, "verify", source)
      before = snapshot(source)[0]
      edited = operation(source, "shared-edited.pdf", {"color" => "#123456"})
      after, paint, = snapshot(edited)
      assert_equal(before["baselines"], after["baselines"])
      assert_equal(before["regions"]["other-rows"], after["regions"]["other-rows"])
      refute_equal(before["regions"]["rows"]["records"], after["regions"]["rows"]["records"])
      paint.each { |id, scope, _| assert_includes(scope, "0.2 G") if id.start_with?("other-") }
      reset = operation(edited, "shared-reset.pdf", reset: true)
      assert_equal(
        [0.7, 0.9],
        snapshot(reset)[1].filter_map { |id, _, state| state["/CA"] if id.start_with?("other-") }.sort
      )
      fixture(
        file("shared-target.pdf"),
        -> (manifest) {
          shared_regions(manifest)
          manifest["targets"]["pattern"].concat(manifest["targets"].delete("other"))
          %w[other-opacity other-display].each { |id| manifest["parameters"].delete(id) }
        },
        pdf_objects: method(:shared_objects)
      )
      reset = operation(file("shared-target.pdf"), "shared-target-reset.pdf", reset: true)
      assert_equal(
        [0.25, 0.7, 0.9, 1],
        snapshot(reset)[1]
          .filter_map { |id, _, state| state["/CA"] if %w[dark dim other-dark other-dim].include?(id) }
          .sort
      )
      extracted = extract(edited, "shared-extracted.pdf", [0])
      assert_equal(before["baselines"], snapshot(extracted)[0]["baselines"])
      wire = JSON.parse(command("qpdf", "--show-attachment=mainz.json", extracted).stdout)
      assert_equal(wire["regions"].values.map { |region| region["recordSet"] }.uniq.sort, wire["recordSets"].keys.sort)
      write("inputs.json", {"input" => source.to_s})
      request = {
        "version" => 1,
        "sources" => %w[a b].to_h { |id|
          [id, {"input" => "input", "overrides" => {"opacity" => 0.15, "other-opacity" => 0.15}}]
        },
        "parts" => [{"pages" => %w[a b].map { |id| {"source" => id, "page" => 0} }}]
      }
      composed, = compose(request, "shared-composed.pdf")
      wire = JSON.parse(command("qpdf", "--show-attachment=mainz.json", composed).stdout)
      assert_equal(2 * before["baselines"].length, wire["baselines"].length)
      assert_equal(3, wire["recordSets"].length)
      command(@cli, "verify", operation(composed, "shared-composed-reset.pdf", reset: true))
    end

    def test_alpha_resources_validate_each_paint_scope
      source = file("scope-alpha.pdf")
      [1, 0.25].each do |alpha|
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
        if alpha == 1
          command(@cli, "verify", source)
        else
          assert_equal("invalid-contract", failure_code(source))
        end
      end
    end

    def test_bindings_require_eligible_records_in_every_target
      source = file("eligible-targets.pdf")
      fixture(source, method(:across_pages), pdf_objects: method(:across_page_objects))
      command(@cli, "verify", source)
      source = file("ineligible-targets.pdf")
      fixture(
        source,
        -> (manifest) { manifest["parameters"]["guide-fill"]["binding"]["targets"] << "pattern" }
      )
      assert_equal("invalid-contract", failure_code(source))
    end

    def test_shared_record_tables_require_complete_valid_bindings
      mutations = [
        -> (m) { m["regions"]["rows"]["recordSet"] = "missing" },
        -> (m) { m["recordSets"]["row"] = [] },
        -> (m) { m["recordSets"]["unused"] = m["recordSets"]["row"] },
        -> (m) { m["regions"]["rows"]["baselineRefs"].delete("first") },
        -> (m) { m["regions"]["rows"]["baselineRefs"]["unused"] = "dark" },
        -> (m) { m["regions"]["rows"]["baselineRefs"]["first"] = "missing" },
        -> (m) { m["regions"]["rows"]["records"] = m["recordSets"]["row"] },
        -> (m) { m["regions"]["other-rows"]["baselineRefs"]["first"] = "filled" }
      ]
      mutations.each do |mutation|
        fixture(
          file("invalid-shared.pdf"),
          -> (m) {
            shared_regions(m)
            mutation.call(m)
          },
          pdf_objects: method(:shared_objects)
        )
        assert_equal("invalid-contract", failure_code(file("invalid-shared.pdf")))
      end

      [nil, {}].each do |table|
        fixture(file("invalid-shared.pdf"), -> (m) { m["recordSets"] = table })
        assert_equal("invalid-contract", failure_code(file("invalid-shared.pdf")))
      end
    end

    def test_shared_record_expansion_obeys_record_and_text_limits
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
      assert_equal("limit-exceeded", failure_code(file("expanded-limit.pdf")))
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
      assert_equal("limit-exceeded", failure_code(file("expanded-text-limit.pdf")))
    end

    def test_profiles_survive_styling_extraction_and_composition
      source = file("profiles.pdf")
      manifest = fixture(source, method(:profile_fixture), pdf_objects: method(:across_page_objects))
      description = command(@cli, "describe", source).stdout
      file("profiles-description.json").binwrite(description)
      assert_equal(manifest["profileSets"], JSON.parse(description)["profileSets"])
      changed = operation(source, "profiles-edited.pdf", manifest["profileSets"][0]["profiles"][1]["overrides"])
      assert_equal(manifest["profileSets"], snapshot(changed)[0]["profileSets"])
      pruned = extract(source, "profiles-extracted.pdf", [0])
      profile = snapshot(pruned)[0]["profileSets"][0]
      assert_equal(["width"], profile["parameters"])
      assert_equal({"width" => 0.15}, profile["profiles"][1]["overrides"])
      write("inputs.json", {"input" => source.to_s})
      request = {
        "version" => 1,
        "sources" => %w[a b].to_h { |id| [id, {"input" => "input", "overrides" => {}}] },
        "parts" => [
          {
            "pages" => [
              {"source" => "a", "page" => 0},
              {"source" => "a", "page" => 1},
              {"source" => "a", "page" => 0},
              {"source" => "b", "page" => 1}
            ]
          }
        ]
      }
      output, result = compose(request, "profiles-composed.pdf")
      sets = snapshot(output)[0]["profileSets"]
      assert_equal(2, sets.length)
      assert_equal(2, sets.map { |item| item["id"] }.uniq.length)
      assert_empty(sets[0]["parameters"] & sets[1]["parameters"])
      mapping = JSON.parse(result.stdout)["parameters"]
      assert_equal(
        [%w[guide-color guide-fill width]] * 2,
        sets.map { |item| item["parameters"].map { |id| mapping[id]["parameter"] }.sort }
      )
    end

    def test_profiles_require_valid_scopes_and_original_first_choice
      mutations = [
        -> (s) { s[0]["extra"] = true },
        -> (s) { s[0]["parameters"] = ["unknown"] },
        -> (s) { s << JSON.parse(JSON.generate(s[0])) },
        -> (s) { s[0]["profiles"][0]["overrides"] = {"width" => 0.1} },
        -> (s) { s[0]["profiles"][1]["overrides"] = {"guide-fill" => 1.1} },
        -> (s) { s[0]["profiles"][1]["overrides"] = {"opacity" => 0.1} },
        -> (s) { s[0]["profiles"][1]["id"] = "generic" },
        -> (s) { s[0]["profiles"][1]["name"] = "" },
        -> (s) { s[0]["profiles"][1]["description"] = false },
        -> (s) { s[0]["profiles"] *= 17 }
      ]
      mutations.each do |mutation|
        fixture(
          file("invalid-profiles.pdf"),
          -> (manifest) {
            profile_fixture(manifest)
            mutation.call(manifest["profileSets"])
          },
          pdf_objects: method(:across_page_objects)
        )
        assert_equal("invalid-contract", failure_code(file("invalid-profiles.pdf")))
      end
    end

    private

    def across_pages(manifest)
      manifest["pages"]["notes"] = 1
      manifest["regions"]["guides"]["page"] = "notes"
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
        "pages" => {"practice" => 0},
        "regions" => {
          "rows" => {
            "page" => "practice",
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
            "page" => "practice",
            "marker" => "Guides",
            "records" => [
              {"path" => [], "marker" => "GuidePaint", "baseline" => "hidden", "fill" => "latent"}
            ]
          },
          "filled" => {
            "page" => "practice",
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
      manifest["profileSets"] = [
        {
          "id" => "print",
          "name" => "Style profile",
          "description" => "Printer styles",
          "parameters" => %w[width guide-color guide-fill],
          "profiles" => [
            {"id" => "generic", "name" => "Generic", "overrides" => {}},
            {
              "id" => "inkjet",
              "name" => "Inkjet",
              "description" => "Light fills and fine lines",
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
        "page" => "practice",
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

    def command(*arguments, ok: true, input: nil)
      result = Mainz.capture(*arguments, input: input)
      assert_equal(ok, result.status.success?, "#{arguments.inspect}: #{result.stdout}#{result.stderr}")
      result
    end

    def describe(path) = JSON.parse(command(@cli, "describe", path).stdout)
    def failure_code(path) = JSON.parse(command(@cli, "verify", path, ok: false).stderr)["code"]
    def file(name) = @directory.join(name)
    def pdf_json(path) = JSON.parse(command("qpdf", "--json", "--json-stream-data=inline", path).stdout)

    def assert_raster(expected, actual)
      assert_equal(
        Digest::SHA256.file(file(expected)).hexdigest,
        Digest::SHA256.file(file(actual)).hexdigest,
        "#{expected} != #{actual}"
      )
    end

    def compose(request, name = "composed.pdf", ok: true)
      write("job.json", request)
      destination = file(name)
      FileUtils.rm_f(destination)
      result = command(
        @cli,
        "compose",
        file("job.json"),
        "--inputs",
        file("inputs.json"),
        "--output",
        destination,
        ok: ok
      )
      refute_path_exists(destination) unless ok
      [destination, result]
    end

    def extract(input, name, selection)
      destination = file(name)
      FileUtils.rm_f(destination)
      request = write("pages.json", selection)
      command(@cli, "extract", input, "--pages", request, "--output", destination)
      destination
    end

    def job
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
      arguments = [@cli, reset ? "reset" : "apply", input, "--output", output]
      arguments += [reset ? "--ids" : "--request", write("request.json", request)] unless request.nil?
      command(*arguments)
      output
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

    def replace_object(index, before, after)
      -> (objects, _) {
        assert_includes(objects[index], before)
        objects[index] = objects[index].gsub(before, after)
      }
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

    def styled
      @styled ||= operation(@source, "edited.pdf", CHOICES)
    end

    def write(name, value)
      path = file(name)
      path.write(JSON.generate(value))
      path
    end
  end
end
