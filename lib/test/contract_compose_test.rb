# frozen_string_literal: true

require_relative "contract_helper"

module Mainz
  class ContractComposeTest < Minitest::Test
    include ContractHelper

    def test_composition_writes_explicit_output_title_and_cover_page
      request = plan
      request["metadata"] = {"title" => "Ink & <Paper> Çalışma\rPart 2", "coverPage" => 2}
      result, = compose(request, "identified.pdf")
      saved = HexaPDF::Document.open(result)
      assert_equal("Ink & <Paper> Çalışma\rPart 2", saved.trailer[:Info][:Title])
      xml = saved.catalog[:Metadata].stream.force_encoding(Encoding::UTF_8)
      assert_includes(xml, "Ink &amp; &lt;Paper&gt; Çalışma&#13;Part 2")
      assert_includes(xml, "<mainz:coverPage>2</mainz:coverPage>")
      assert_equal(10, describe(result)["pageCount"])
      [0, 11, 1.5].each do |page|
        request["metadata"]["coverPage"] = page
        _, failure = compose(request, "invalid-title.pdf", ok: false)
        assert_equal("/metadata", JSON.parse(failure.stderr)["location"])
      end

      request["metadata"] = {"title" => "bad\u0001text", "coverPage" => 1}
      _, failure = compose(request, "invalid-title.pdf", ok: false)
      assert_equal("invalid-request", JSON.parse(failure.stderr)["code"])
    end

    def test_extraction_preserves_content_and_rebuilds_the_contract
      one = extract(styled, "extracted.pdf", [0])
      pristine = extract(@source, "extracted-pristine.pdf", [0])
      command(@cli, "verify", one)
      assert_equal(1, describe(one)["pageCount"])
      expected_manifest = snapshot(styled)[0]
      expected_manifest["pages"] = [expected_manifest["pages"][0]]
      assert_equal(expected_manifest, snapshot(one)[0])
      assert_equal(page_snapshot(styled, 0), page_snapshot(one, 0))
      one_reset = operation(one, "extracted-reset.pdf", reset: true)
      reset = operation(styled, "reset.pdf", reset: true)
      assert_equal(snapshot(reset)[1].map(&:last), snapshot(one_reset)[1].map(&:last))
      expected = Preservation.read(pristine)
      assert_equal(expected, Preservation.read(one))
      assert_equal(expected, Preservation.read(one_reset))
      assert_equal(@source.binread, extract(@source, "extracted-all.pdf", [0, 1]).binread)
      reverse = extract(@source, "extracted-reverse.pdf", [1, 0])
      assert_equal([1], describe(reverse)["parameters"]["opacity"]["pages"])
      assert_equal(page_snapshot(@source, 1), page_snapshot(reverse, 0))
      assert_equal(page_snapshot(@source, 0), page_snapshot(reverse, 1))
      cover = extract(@source, "extracted-ordinary.pdf", [1])
      command("qpdf", "--check", cover)
      assert_equal(page_snapshot(@source, 1), page_snapshot(cover, 0))
      assert_equal("missing-contract", failure_code(cover))
      refute_includes(command("qpdf", "--list-attachments", cover).stdout, "mainz.json")
      assert_equal("Unrelated attachment.\n", command("qpdf", "--show-attachment=notes.txt", cover).stdout)
      assert_equal({"version" => 1, "pageCount" => 1, "pages" => [{}], "parameters" => {}}, describe(cover))
      assert_equal(cover.binread, extract(cover, "ordinary-all.pdf", [0]).binread)
      ordinary_request = write("ordinary-request.json", {})
      [["style", ["--overrides", ordinary_request]], ["reset", []]].each do |operation, options|
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
      source, manifest = labeled_fixture
      command(@cli, "verify", source)
      assert_equal("Practice-i", describe(source)["pages"][0]["label"])
      pruned = extract(source, "extracted-pruned.pdf", [0])
      assert_equal("Practice-i", describe(pruned)["pages"][0]["label"])
      actual = snapshot(pruned)[0]
      assert_equal(%w[filled rows], actual["regions"].keys.sort)
      assert_equal(%w[dark dim filled], actual["baselines"].keys.sort)
      assert_equal(["rows"], actual["targets"]["pattern"])
      assert_equal((manifest["parameters"].keys - %w[guide-fill guide-color]).sort, actual["parameters"].keys.sort)
      assert_equal(manifest["parameters"]["opacity"], actual["parameters"]["opacity"])
      assert_equal([manifest["groups"].first], actual["groups"])
      assert_equal(page_snapshot(source, 0), page_snapshot(pruned, 0))
      notes = extract(source, "extracted-notes.pdf", [1])
      assert_equal([{"label" => "Practice-7"}], describe(notes)["pages"])
      assert_equal(page_snapshot(source, 1), page_snapshot(notes, 0))
      command(@cli, "verify", operation(notes, "extracted-notes-reset.pdf", reset: true))
    end

    def test_page_selection_prunes_targets_without_eligible_bindings
      [false, true].each do |keep_fill|
        name = keep_fill ? "fill-mixed" : "fill-only"
        source = file("#{name}.pdf")
        fills_fixture(source, keep_fill)
        command(@cli, "verify", source)
        write("inputs.json", {"input" => source.to_s})
        [0, 1].each do |index|
          extracted = extract(source, "#{name}-extracted-#{index}.pdf", [index])
          composed, = compose(
            {
              "version" => 1,
              "sources" => {"original" => {"input" => "input", "overrides" => {}}},
              "parts" => [{"pages" => [{"source" => "original", "page" => index}]}]
            },
            "#{name}-composed-#{index}.pdf"
          )
          properties = keep_fill ? ["fill-color"] : []
          properties = ["fill-opacity"] if index == 1
          [extracted, composed].each do |path|
            command("qpdf", "--check", path)
            actual = describe(path).fetch("parameters").values.map { it["parameter"]["binding"]["property"] }
            assert_equal(properties, actual)
            assert_equal(page_snapshot(source, index), page_snapshot(path, 0))
          end
        end
      end
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

    def test_composition_isolates_source_styles_and_tracks_padding
      composed, result = compose(plan)
      provenance = JSON.parse(result.stdout)
      assert_equal(10, provenance["pages"].length)
      assert_equal(
        {"part" => 1, "copy" => 0, "blank" => {"width" => 127, "height" => 127}, "padding" => true},
        provenance["pages"][1]
      )
      assert_equal(
        {"part" => 1, "copy" => 0, "blank" => {"width" => 210, "height" => 297}, "padding" => true},
        provenance["pages"][5]
      )
      assert(provenance["pages"][9]["padding"])
      assert_equal(1, provenance["pages"][9]["copy"])
      command("qpdf", "--check", composed)
      description = describe(composed)
      assert_equal(10, description["pageCount"])
      assert_equal(
        [@original["groups"][0]["description"]] * 2,
        description["groups"].map { |group| group["description"] }
      )
      identities = provenance["parameters"].to_h { |id, value| [[value["source"], value["parameter"]], id] }
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
    end

    def test_composition_indexes_reordered_repeated_regions
      source = file("extraction-pages.pdf")
      fixture(source, method(:across_pages), pdf_objects: method(:across_page_objects))
      write("inputs.json", {"input" => source.to_s})
      output, result = compose(
        {
          "version" => 1,
          "sources" => {"book" => {"input" => "input", "overrides" => {}}},
          "parts" => [{"pages" => [1, 0, 1].map { |page| {"source" => "book", "page" => page} }, "copies" => 2}]
        },
        "indexed.pdf"
      )
      assert_equal([1, 0, 1, 1, 0, 1], JSON.parse(result.stdout)["pages"].map { |page| page["page"] })
      wire = JSON.parse(command("qpdf", "--show-attachment=mainz.json", output).stdout)
      assert_equal(%w[p0:guides p1:rows p2:guides p3:guides p4:rows p5:guides], wire["targets"]["s0:pattern"])
      assert_equal(%w[p1:filled p4:filled], wire["targets"]["s0:filled"])
      description = describe(output)
      assert_equal([0, 1, 2, 3, 4, 5], description["parameters"]["s0:width"]["pages"])
      assert_equal([0, 2, 3, 5], description["parameters"]["s0:guide-color"]["pages"])
      reset = operation(output, "indexed-reset.pdf", reset: true)
      original = Mainz::Preservation.read(source)
      restored = Mainz::Preservation.read(reset)
      [1, 0, 1, 1, 0, 1].each_with_index do |physical, index|
        assert_equal(original[physical], restored[index])
      end
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

    def test_composition_rejects_invalid_plans_and_identifiers
      invalids = [
        plan.merge("version" => 2),
        plan.merge("extra" => true),
        plan.merge("parts" => [{"pages" => [{"source" => "baseline", "page" => 99}]}]),
        plan.merge("parts" => [{"pages" => [{"source" => "baseline", "page" => 0}], "copies" => 1001}]),
        plan.merge(
          "sources" => plan["sources"].merge("edited" => {"input" => "input", "overrides" => {"opacity" => 2}})
        ),
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
        "oversized-plan.pdf",
        ok: false
      )
      assert_equal("limit-exceeded", JSON.parse(failure.stderr)["code"])
    end

    def test_whole_input_composition_preserves_document_structure_and_styles
      source = file("whole-input.pdf")
      fixture(source, -> (manifest) { manifest["pages"] = [{"name" => "Cover"}, {"name" => "Details"}] })
      document = HexaPDF::Document.open(source)
      document.trailer[:Info] = document.add({Author: "Original author"})
      xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/">Unrelated metadata</x:xmpmeta>'
      document.catalog[:Metadata] = document.add({Type: :Metadata, Subtype: :XML}, stream: xml)
      document.catalog[:PageLabels] = {Nums: [0, {S: :r}]}
      document.outline.add_item("Book", destination: document.pages[0], open: false) do |item|
        item.add_item("Details", destination: document.pages[1])
      end
      document.write(source.to_s)
      write("inputs.json", {"input" => source.to_s})
      request = {"version" => 1, "sources" => {"source" => {"input" => "input", "overrides" => {"opacity" => 0.4}}},
                 "parts" => [{"pages" => [0, 1].map { {"source" => "source", "page" => it} }}]}
      output, result = compose(request, "whole-styled.pdf")
      saved = HexaPDF::Document.open(output)
      assert_equal(xml, saved.catalog[:Metadata].stream)
      assert_equal("Original author", saved.trailer[:Info][:Author])
      summarize = -> (items) { items.map { [it["title"], it["destpageposfrom1"], it["open"], summarize.call(it["kids"])] } }
      assert_equal([["Book", 1, false, [["Details", 2, true, []]]]], summarize.call(pdf_json(output)["outlines"]))
      assert_equal(describe(source)["pages"], describe(output)["pages"])
      assert_equal(Preservation.read(source), Preservation.read(output))
      assert_equal(0.4, describe(output)["parameters"]["opacity"]["parameter"]["value"])
      assert_equal({"source" => "source", "parameter" => "opacity"}, JSON.parse(result.stdout)["parameters"]["opacity"])
      request["sources"]["source"]["overrides"] = describe(source)["parameters"].filter_map do |id, entry|
        parameter = entry["parameter"]
        [id, parameter["value"]] if parameter.key?("value")
      end.to_h
      unchanged, = compose(request, "whole-unchanged.pdf")
      assert_equal(source.binread, unchanged.binread)
    end

    def test_composition_prunes_and_orders_real_outline_sections
      source = section_fixture
      document = HexaPDF::Document.open(source)
      write("inputs.json", {"input" => source.to_s})
      request = {"version" => 1, "sources" => {"a" => {"input" => "input", "overrides" => {}}},
                 "parts" => [{"pages" => [0, 6, 2, 6, 5, 7].map { {"source" => "a", "page" => it} }}]}
      output, = compose(request, "pruned-outline.pdf")
      summarize = -> (items) { items.map { [it["title"], it["destpageposfrom1"], summarize.call(it["kids"])] } }
      assert_equal(
        [["Book", 2, [["Second", 2, [["Detail", 2, []]]], ["First", 3, []]]], ["Prelude", 6, []]],
        summarize.call(pdf_json(output)["outlines"])
      )
      command("qpdf", "--check", output)
      request["sources"]["b"] = {"input" => "input", "overrides" => {}}
      request["parts"] = [{"pages" => [["a", 6], ["b", 2], ["a", 2], ["b", 7]].map { |id, page| {"source" => id, "page" => page} }}]
      multiple, = compose(request, "multiple-outlines.pdf")
      assert_equal(
        [["Book", 1, [["Second", 1, [["Detail", 1, []]]], ["First", 3, []]]],
         ["Book", 2, [["First", 2, []]]], ["Prelude", 4, []]],
        summarize.call(pdf_json(multiple)["outlines"])
      )
      document.catalog[:Outlines][:First][:Dest] = [document.pages[4], :Fit]
      document.write(source.to_s)
      request["sources"].delete("b")
      request["parts"] = [{"pages" => [{"source" => "a", "page" => 2}]}]
      context, = compose(request, "nonmonotonic-outline.pdf")
      assert_equal([["Book", 1, [["First", 1, []]]]], summarize.call(pdf_json(context)["outlines"]))
    end

    def test_composition_groups_source_blocks_under_their_titles
      document = HexaPDF::Document.open(@source)
      document.outline.add_item("Book", destination: document.pages[0]) do |book|
        book.add_item("Details", destination: document.pages[1])
      end

      document.write(@source.to_s)
      request = {
        "version" => 1,
        "sources" => {
          "a" => {"input" => "input", "title" => "First book", "overrides" => {"opacity" => 0.4}},
          "b" => {"input" => "input", "title" => "Second book", "overrides" => {}}
        },
        "parts" => [
          {"pages" => [["a", 0], ["a", 1], ["b", 0], ["b", 1]].map { |id, page| {"source" => id, "page" => page} }}
        ]
      }
      summarize = -> (items) { items.map { [it["title"], it["destpageposfrom1"], summarize.call(it["kids"])] } }
      output, = compose(request, "grouped-books.pdf")
      assert_equal(
        [
          ["First book", 1, [["Book", 1, [["Details", 2, []]]]]],
          ["Second book", 3, [["Book", 3, [["Details", 4, []]]]]]
        ],
        summarize.call(pdf_json(output)["outlines"])
      )
      request["parts"] = [{"pages" => [["b", 1], ["a", 1]].map { |id, page| {"source" => id, "page" => page} }}]
      subset, = compose(request, "grouped-subsets.pdf")
      expected = [
        ["Second book", 1, [["Book", 1, [["Details", 1, []]]]]],
        ["First book", 2, [["Book", 2, [["Details", 2, []]]]]]
      ]
      assert_equal(expected, summarize.call(pdf_json(subset)["outlines"]))
      command("qpdf", "--check", subset)
      recipe = request.merge(
        "inputs" => {"input" => {"sha256" => Digest::SHA256.file(@source).hexdigest, "pageCount" => 2}},
        "sources" => request["sources"].transform_values do |source|
          source.merge("overrides" => source["overrides"].map { |id, value| {"id" => id, "value" => value} })
        end
      )
      path = write("grouped-recipe.json", recipe)
      resolved = command(@cli, "resolve", path, "--inputs", file("inputs.json"))
      assert_equal(request["sources"], JSON.parse(resolved.stdout)["sources"])
      replay = file("grouped-replay.pdf")
      FileUtils.rm_f(replay)
      command(@cli, "apply", path, "--inputs", file("inputs.json"), "--output", replay)
      assert_equal(expected, summarize.call(pdf_json(replay)["outlines"]))
      request["parts"] = [
        {"pages" => [["a", 0], ["b", 0], ["a", 1]].map { |id, page| {"source" => id, "page" => page} }}
      ]
      interleaved, = compose(request, "interleaved-books.pdf")
      assert_equal(
        [
          ["First book", 1, [["Book", 1, []]]],
          ["Second book", 2, [["Book", 2, []]]],
          ["First book", 3, [["Book", 3, [["Details", 3, []]]]]]
        ],
        summarize.call(pdf_json(interleaved)["outlines"])
      )
      ordinary = file("no-outline.pdf")
      HexaPDF::Document.new.tap { it.pages.add }.write(ordinary.to_s)
      write("inputs.json", {"input" => @source.to_s, "ordinary" => ordinary.to_s})
      request["sources"]["b"]["input"] = "ordinary"
      request["parts"] = [{"pages" => [{"source" => "a", "page" => 1}, {"source" => "b", "page" => 0}]}]
      untitled, = compose(request, "unbookmarked-block.pdf")
      assert_equal(
        [["First book", 1, [["Book", 1, [["Details", 1, []]]]]], ["Second book", 2, []]],
        summarize.call(pdf_json(untitled)["outlines"])
      )
    end

    def test_composition_attaches_blanks_and_padding_to_preceding_source_blocks
      source = file("ten-pages.pdf")
      document = HexaPDF::Document.new
      10.times { document.pages.add }
      document.outline.add_item("Contents", destination: document.pages[0]) do |book|
        book.add_item("Early", destination: document.pages[0])
        book.add_item("Late", destination: document.pages[5])
      end

      document.write(source.to_s)
      write("inputs.json", {"input" => source.to_s})
      blank = {"blank" => {"width" => 210, "height" => 297}}
      sequence = [
        nil,
        ["a", 3],
        ["a", 5],
        nil,
        ["b", 1],
        ["b", 4],
        ["b", 3],
        ["b", 3],
        ["a", 2],
        ["a", 9],
        ["b", 7],
        ["a", 1],
        ["a", 8],
        nil
      ]
      request = {
        "version" => 1,
        "sources" => {
          "a" => {"input" => "input", "title" => "Book A", "overrides" => {}},
          "b" => {"input" => "input", "title" => "Book B", "overrides" => {}}
        },
        "parts" => [{"pages" => sequence.map { it ? {"source" => it[0], "page" => it[1] - 1} : blank }}]
      }
      output, = compose(request, "source-blocks.pdf")
      summarize = -> (items) { items.map { [it["title"], it["destpageposfrom1"], summarize.call(it["kids"])] } }
      assert_equal(
        [
          ["Book A", 2, [["Contents", 2, [["Early", 2, []]]]]],
          ["Book B", 5, [["Contents", 5, [["Early", 5, []]]]]],
          ["Book A", 9, [["Contents", 9, [["Early", 9, []], ["Late", 10, []]]]]],
          ["Book B", 11, [["Contents", 11, [["Late", 11, []]]]]],
          ["Book A", 12, [["Contents", 12, [["Early", 12, []], ["Late", 13, []]]]]]
        ],
        summarize.call(pdf_json(output)["outlines"])
      )
      command("qpdf", "--check", output)
      request["parts"] = [
        {"pages" => [{"source" => "a", "page" => 2}], "front" => true},
        {"pages" => [{"source" => "b", "page" => 6}], "front" => true},
        {"pages" => [{"source" => "a", "page" => 8}], "front" => true}
      ]
      padded, = compose(request, "padded-source-blocks.pdf")
      assert_equal(
        [
          ["Book A", 1, [["Contents", 1, [["Early", 1, []]]]]],
          ["Book B", 3, [["Contents", 3, [["Late", 3, []]]]]],
          ["Book A", 5, [["Contents", 5, [["Late", 5, []]]]]]
        ],
        summarize.call(pdf_json(padded)["outlines"])
      )
      assert_equal(6, describe(padded)["pageCount"])
    end

    def test_composition_and_recipe_reject_invalid_source_titles
      ["", " ", "x" * 4097, "Invalid\u0000title"].each do |title|
        request = plan
        request["sources"].each_value { it["title"] = title }
        _, failure = compose(request, "invalid-source-title.pdf", ok: false)
        code = title.bytesize > 4096 ? "limit-exceeded" : "invalid-request"
        assert_equal(code, JSON.parse(failure.stderr)["code"])
        assert_match(%r{\A/sources/[^/]+/title\z}, JSON.parse(failure.stderr)["location"]) if title.bytesize <= 4096
        recipe = request.merge(
          "inputs" => {"input" => {}},
          "sources" => request["sources"].transform_values { {"input" => "input", "title" => title} }
        )
        result = command(
          @cli,
          "resolve",
          write("invalid-source-title.json", recipe),
          "--inputs",
          file("inputs.json"),
          ok: false
        )
        assert_equal(code, JSON.parse(result.stderr)["code"])
      end
    end

    def test_composition_outline_titles_use_utf8_byte_limits
      cases = JSON.parse(Mainz::ROOT.join("lib/test/fixtures/outlines.json").read)
      cases.each_with_index do |item, index|
        title = item.fetch("text") * item.fetch("repeat")
        document = HexaPDF::Document.new
        2.times { document.pages.add }
        document.outline.add_item(title, destination: document.pages[0]) do |parent|
          parent.add_item("Child", destination: document.pages[0])
        end
        source = file("title-#{index}.pdf")
        document.write(source.to_s)
        write("inputs.json", {"input" => source.to_s})
        request = {"version" => 1, "sources" => {"a" => {"input" => "input", "overrides" => {}}},
                   "parts" => [{"pages" => [{"source" => "a", "page" => 0}]}]}
        output, = compose(request, "title-result-#{index}.pdf")
        outlines = pdf_json(output)["outlines"]
        assert_equal(item.fetch("retained") ? title : "Child", outlines.first.fetch("title"))
        assert_equal(item.fetch("retained") ? ["Child"] : [], outlines.first.fetch("kids", []).map { it.fetch("title") })
      end
    end

    def test_composition_bounds_outline_traversal_and_retains_navigable_children
      source = file("outline-context.pdf")
      document = HexaPDF::Document.new
      3.times { document.pages.add }
      document.catalog[:Names] = {Dests: {Names: ["local", [document.pages[1], :Fit]]}}
      document.outline.add_item("External", action: {S: :URI, URI: "https://example.invalid"}) do |item|
        child = item.add_item("Local", destination: "local")
        child[:Next] = child
      end
      document.write(source.to_s)
      write("inputs.json", {"input" => source.to_s})
      request = {"version" => 1, "sources" => {"a" => {"input" => "input", "overrides" => {}}},
                 "parts" => [{"pages" => [{"source" => "a", "page" => 1}]}]}
      output, = compose(request, "local-outline.pdf")
      assert_equal([["Local", 1]], pdf_json(output)["outlines"].map { [it["title"], it["destpageposfrom1"]] })
      parent = document.catalog[:Outlines] = document.add({Type: :Outlines})
      65.times do
        item = document.add({Title: "Deep", Dest: [document.pages[1], :Fit], Parent: parent})
        parent[:First] = item
        parent = item
      end
      document.write(source.to_s)
      _, failure = compose(request, "deep-outline.pdf", ok: false)
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

    def test_composed_repeated_titled_source_preserves_outline_destinations
      request = {
        "version" => 1,
        "sources" => {
          "a" => {"input" => "input", "overrides" => {}, "title" => "Alpha"},
          "b" => {"input" => "input", "overrides" => {}, "title" => "Beta"}
        },
        "parts" => [
          {
            "pages" => [
              {"source" => "a", "page" => 0},
              {"source" => "b", "page" => 1},
              {"source" => "a", "page" => 0},
              {"source" => "b", "page" => 1}
            ],
            "copies" => 2
          }
        ]
      }
      composed, = compose(request, "repeated-titled-outlines.pdf")
      assert_equal(true, command(@cli, "verify", composed).status.success?)
      outlines = pdf_json(composed).fetch("outlines", [])
      assert_equal(
        [["Alpha", 1], ["Beta", 2], ["Alpha", 3], ["Beta", 4], ["Alpha", 5], ["Beta", 6], ["Alpha", 7], ["Beta", 8]],
        outlines.map { |item| [item["title"], item["destpageposfrom1"]] }
      )
    end
  end
end
