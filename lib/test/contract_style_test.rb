# frozen_string_literal: true

require_relative "contract_helper"

module Mainz
  class ContractStyleTest < Minitest::Test
    include ContractHelper

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
      source = dense_manifest_fixture
      edited = operation(source, "dense-manifest-edited.pdf", {"opacity" => 0.65})
      assert_equal(17_000, describe(edited)["groups"].length)
      assert_equal(0.65, describe(edited)["parameters"]["opacity"]["parameter"]["value"])
    end

    def test_noops_and_repeated_choices_preserve_bytes
      initial = snapshot(@source)
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
      assert_equal(page_two(initial), page_two(snapshot(styled)))
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
        failure = command(@cli, "style", @source, "--overrides", file("invalid.json"), "--output", protected, ok: false)
        error = JSON.parse(failure.stderr)
        assert_equal("invalid-request", error["code"])
        assert_equal("request", error["source"])
        assert_equal("existing output", protected.binread)
      end

      file("invalid.json").write("[\"opacity\",\"opacity\"]")
      command(@cli, "reset", @source, "--ids", file("invalid.json"), "--output", protected, ok: false)
      assert_empty(@directory.glob(".mainz-*"))
    end

    def test_opaque_ids_survive_document_operations
      source, suffix, opacity = opaque_fixture
      assert_equal(2, describe(source)["pages"].length)
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

    def test_vector_tokens_preserve_offsets_and_numeric_spelling
      ["vector", "fallback"].each do |variant|
        source = file("#{variant}.pdf")
        fixture(
          source,
          pdf_objects: -> (objects, _) {
            prefix = variant == "fallback" ? "% # QPDF lexer\r\n" : "% Vector lexer\r\n"
            objects[6] = objects[6].sub("\nstream\n", "\nstream\n#{prefix}q[1 +02.00] .5 d\n")
            objects[6] = objects[6].sub("\nendstream", "\nQ\nendstream")
          }
        )
        edited = operation(source, "#{variant}-edited.pdf", {"color" => "#123456", "width" => 0.25})
        assert_equal(Preservation.read(source), Preservation.read(edited))
        assert_equal("#123456", describe(edited)["parameters"]["color"]["parameter"]["value"])
        command(@cli, "verify", edited)
      end
    end

    def test_context_and_resource_mismatches_are_rejected
      source = different_alpha_fixture
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
        moves_fixture(rectangle, suffix)
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
      source = duplicate_fill_fixture
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

    def test_shared_records_isolate_styles_and_retain_baselines
      source = shared_fixture
      command(@cli, "verify", source)
      before = snapshot(source)[0]
      edited = operation(source, "shared-edited.pdf", {"color" => "#123456"})
      after, paint, = snapshot(edited)
      assert_equal(before["baselines"], after["baselines"])
      assert_equal(before["regions"]["other-rows"], after["regions"]["other-rows"])
      refute_equal(before["regions"]["rows"]["records"], after["regions"]["rows"]["records"])
      paint.each { |id, scope, _| assert_includes(scope, "0.2 G") if id.start_with?("other-") }
      chained = operation(edited, "shared-changed.pdf", {"other-opacity" => 0.4})
      chained = operation(chained, "shared-chained.pdf", ["color"], reset: true)
      assert_equal(Preservation.read(source), Preservation.read(chained))
      snapshot(chained)[1].each do |id, scope, state|
        assert_includes(scope, "0.2 G")
        assert_equal(0.4, state["/CA"]) if id.start_with?("other-")
      end

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

    def test_matching_styles_remain_independent_after_edits
      source = file("matching-styles.pdf")
      fixture(source, method(:shared_regions), pdf_objects: method(:shared_objects))
      uniform = operation(source, "matching-styles-uniform.pdf", {"opacity" => 0.4, "other-opacity" => 0.4})
      changed = operation(uniform, "matching-styles-changed.pdf", {"opacity" => 0.6})
      assert_equal(Preservation.read(source), Preservation.read(changed))
      snapshot(changed)[1].each do |id, _, state|
        next unless %w[dark dim other-dark other-dim].include?(id)

        assert_equal(id.start_with?("other-") ? 0.4 : 0.6, state["/CA"])
      end
    end

    def test_bindings_require_eligible_records_in_every_target
      source = file("eligible-targets.pdf")
      fixture(source, method(:across_pages), pdf_objects: method(:across_page_objects))
      command(@cli, "verify", source)
      source = file("ineligible-targets.pdf")
      ineligible_fixture(source)
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

    def test_many_short_latent_paths_survive_storage_growth
      source = file("sso-latent-growth.pdf")
      fills = (1..80).map { |x| "#{x} 1 1 1 re f" }.join("\n")
      latents = (1..80).map { |x| "#{x} 2 1 1 re n" }.join("\n")
      fixture(
        source,
        pdf_objects: -> (objects, _stream) {
          objects[4] = objects[4].sub("\nendstream", "\nq 0 g\n#{fills}\n#{latents}\nQ\nendstream")
        }
      )
      styled = operation(source, "sso-latent-styled.pdf", {"opacity" => 0.4})
      assert_equal(true, command(@cli, "verify", styled).status.success?)
      assert_equal(0.4, snapshot(styled)[0]["parameters"]["opacity"]["value"])
    end

    def test_nested_forms_across_regions_update_locators_after_prior_change
      source = file("nested-forms-shared.pdf")
      fixture(
        source,
        -> (manifest) {
          row_records = manifest["regions"]["rows"]["records"]
          row2_records = row_records.map do |rec|
            rec.merge("path" => [{"resource" => "Row2", "occurrence" => 0}, rec["path"][1]])
          end
          combined = row_records + row2_records
          manifest["regions"]["rows"]["records"] = combined
          manifest["regions"]["rows2"] = {"page" => 0, "marker" => "Rows2", "records" => Marshal.load(Marshal.dump(combined))}
          manifest["targets"]["pattern"] = %w[rows rows2]
        },
        pdf_objects: -> (objects, _stream) {
          objects << objects[5]
          objects[2] = objects[2]
            .sub("/Row 6 0 R", "/Row 6 0 R /Row2 15 0 R")
            .sub("/Rows <<>>", "/Rows <<>> /Rows2 <<>>")
          objects[4] = objects[4].sub(
            "/Figure /Rows BDC q /Row Do Q EMC",
            "/Figure /Rows BDC q /Row Do /Row2 Do Q EMC\n/Figure /Rows2 BDC q /Row Do /Row2 Do Q EMC"
          )
        }
      )
      styled = operation(source, "nested-forms-styled.pdf", {"opacity" => 0.4})
      assert_equal(true, command(@cli, "verify", styled).status.success?)
      manifest, = snapshot(styled)
      %w[rows rows2].each do |region_id|
        second_form_paths = manifest.dig("regions", region_id, "records").map { |rec| rec["path"] }
        assert_equal(4, second_form_paths.length)
        refute_equal("Shape", second_form_paths[1][1]["resource"])
        refute_equal("Shape", second_form_paths[3][1]["resource"])
      end
    end

    def test_clipped_non_editable_fill_conflicts_with_latent_fill
      source = file("clipped-latent-conflict.pdf")
      fixture(
        source,
        pdf_objects: -> (objects, _stream) {
          objects[4] = objects[4].sub("\nendstream", "\nq 0 g 10 100 40 40 re 20 110 20 20 re W f Q\nendstream")
        }
      )
      assert_equal("invalid-contract", failure_code(source))
    end
  end
end
