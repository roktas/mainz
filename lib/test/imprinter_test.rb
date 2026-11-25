# frozen_string_literal: true

require "minitest/autorun"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::Preservation)

module Mainz
  class ImprinterTest < Minitest::Test
    IMAGE = "<image x=\"30\" y=\"90\" width=\"20\" height=\"20\" href=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM/////w8AH+4F+7C4l8kAAAAASUVORK5CYII=\"/>"
    SHAPE = "<g id=\"Guides\" style=\"fill:none;stroke:black;stroke-width:1\"><rect x=\"30\" y=\"30\" width=\"50\" height=\"40\"/></g>"

    def setup
      @directory = Pathname(Dir.mktmpdir("imprinter-", Mainz.workspace("tmp/test/imprinter").to_s))
      @cli = File.expand_path(ENV.fetch("MAINZ_CLI"))
    end

    def teardown
      FileUtils.remove_entry(@directory)
    end

    def test_preview_supports_metadata_only_documents
      source = @directory.join("source.svg")
      source.write(svg(SHAPE))
      image = @directory.join("preview.png")
      image.binwrite(png)
      data = {"targets" => {}, "parameters" => {}, "page" => {"name" => "Practice", "tags" => ["guides"]}}
      output = pdf("imprint", "metadata.pdf", source, "--declaration", write("metadata.json", data), "--preview", image)
      summary = JSON.parse(command(@cli, "describe", output).stdout)
      assert_equal({}, summary["parameters"])
      assert_equal(
        [
          {
            "name" => "Practice",
            "tags" => ["guides"],
            "preview" => {"file" => "preview.png", "width" => 1, "height" => 1}
          }
        ],
        summary["pages"]
      )
      assert(JSON.parse(command(@cli, "verify", output).stdout)["valid"])
      assert_equal(png, command("qpdf", "--show-attachment=preview.png", output).stdout)
      reference = @directory.join("reference.pdf")
      command("rsvg-convert", "--format=pdf", "--output", reference, source)
      assert_equal(appearance(reference), appearance(output), "metadata-only")
      data.delete("page")
      preview_only = pdf(
        "imprint",
        "preview-only.pdf",
        source,
        "--declaration",
        write("preview-only.json", data),
        "--preview",
        image
      )
      assert_equal(
        {"file" => "preview.png", "width" => 1, "height" => 1},
        JSON.parse(command(@cli, "describe", preview_only).stdout)["pages"][0]["preview"]
      )
    end

    def test_preview_follows_authored_styles_and_invalidation
      source = @directory.join("source.svg")
      source.write(svg(SHAPE))
      image = @directory.join("preview.png")
      image.binwrite(png)
      data = declaration({"guides" => "#Guides"})
      data["parameters"]["guides.stroke-opacity"]["value"] = 0.4
      declared = write("declaration.json", data)
      output = pdf("imprint", "prepared.pdf", source, "--declaration", declared, "--preview", image)
      summary = JSON.parse(command(@cli, "describe", output).stdout)
      assert_equal(0.4, summary["parameters"]["guides.stroke-opacity"]["parameter"]["value"])
      assert_equal("preview.png", summary["pages"][0]["preview"]["file"])
      ordinary_preview = pdf("imprint", "without-preview.pdf", source, "--declaration", declared)
      assert_equal(appearance(ordinary_preview), appearance(output), "preview-pixels")
      repeated = pdf(
        "style",
        "unchanged.pdf",
        output,
        "--overrides",
        write("same.json", {"guides.stroke-opacity" => 0.4})
      )
      assert_equal(output.binread, repeated.binread)
      changed = pdf(
        "style",
        "changed.pdf",
        output,
        "--overrides",
        write("changed.json", {"guides.stroke-opacity" => 0.5})
      )
      refute(JSON.parse(command(@cli, "describe", changed).stdout)["pages"][0].key?("preview"))
      refute_includes(command("qpdf", "--list-attachments", changed).stdout, "preview.png")
      reset = pdf("reset", "reset.pdf", output)
      refute(JSON.parse(command(@cli, "describe", reset).stdout)["pages"][0].key?("preview"))
    end

    def test_preview_rejects_invalid_pngs_without_output
      source = @directory.join("source.svg")
      source.write(svg(SHAPE))
      declared = write("metadata.json", {"targets" => {}, "parameters" => {}})
      image = @directory.join("invalid.png")
      signature = "\x89PNG\r\n\x1a\n".b
      invalids = [
        "",
        "not png",
        png.byteslice(0, 20),
        png.sub("IDAT", "JDAT"),
        png.sub(png_chunk("IEND", ""), png_chunk("acTL", [1, 0].pack("NN")) + png_chunk("IEND", "")),
        signature + png_chunk("IHDR", [0, 1, 8, 2, 0, 0, 0].pack("NNCCCCC")),
        signature + png_chunk("IHDR", [4097, 4097, 8, 2, 0, 0, 0].pack("NNCCCCC"))
      ]
      invalids.each_with_index do |bytes, index|
        image.binwrite(bytes)
        output = @directory.join("invalid-#{index}.pdf")
        result = command(
          @cli,
          "imprint",
          source,
          "--declaration",
          declared,
          "--preview",
          image,
          "--output",
          output,
          ok: false
        )
        assert_equal(1, result.status.exitstatus)
        assert_includes(%w[invalid-contract limit-exceeded], JSON.parse(result.stderr)["code"])
        refute_path_exists(output)
      end

      image.binwrite(png)
      result = command(
        @cli,
        "imprint",
        "-",
        "--declaration",
        declared,
        "--preview",
        "-",
        "--output",
        @directory.join("stdin.pdf"),
        ok: false
      )
      assert_equal(2, result.status.exitstatus)
      assert_includes(result.stderr, "Only one input can use stdin")
    end

    def test_production_preserves_rendering_and_declared_styles
      cases.each do |label, source, data, options|
        if label == "hidden"
          data["targets"]["guides"]["display"] = "none"
          data["parameters"]["guides.stroke-opacity"]["value"] = 0.15
        end

        data["groups"] = [
          {
            "title" => "Visibility",
            "description" => "Object visibility.",
            "details" => "Controls the complete selected object.",
            "parameters" => [data["parameters"].keys.first]
          }
        ]
        ids = data["parameters"].keys
        data["parameters"].each_value do |parameter|
          parameter["schema"].merge!(
            "description" => "Changes this property.",
            "details" => "Applies to the declared targets.\n\nPlain text only."
          )
        end

        data["parameters"].each { |id, parameter| parameter.merge!("family" => "producer", "key" => id) }

        data["profileSets"] = [
          {
            "id" => "print",
            "family" => "producer",
            "name" => "Print",
            "description" => "Printing styles.",
            "details" => "Choose a complete set of property values.",
            "parameters" => ids,
            "profiles" => [
              {"id" => "original", "name" => "Original", "overrides" => {}},
              {
                "id" => "lighter",
                "name" => "Lighter",
                "description" => "Lighter ink coverage.",
                "details" => "Reduces ink coverage.\n\nCheck fine lines on your printer.",
                "overrides" => {ids[1] => 0.3}
              }
            ]
          }
        ]
        source_path = @directory.join("#{label}.svg")
        source_path.write(source)
        declared = write("#{label}.json", data)
        native = pdf("imprint", "#{label}-native.pdf", source_path, "--declaration", declared, *options)
        summary = JSON.parse(command(@cli, "describe", native).stdout)
        assert_equal(1, summary["pageCount"], label)
        assert_equal(data["parameters"].keys.sort, summary["parameters"].keys.sort, label)
        data["parameters"].each do |id, parameter|
          assert_equal(parameter["schema"], summary["parameters"][id]["parameter"]["schema"], label)
          assert_equal(
            parameter.slice("family", "key"),
            summary["parameters"][id]["parameter"].slice("family", "key"),
            label
          )
        end

        assert_equal(data["profileSets"], summary["profileSets"], label)
        assert_equal(data["groups"].first, summary["groups"].first, label)
        if label == "structural-style"
          assert_equal("#FF0000", summary["parameters"]["guides.stroke-color"]["baseline"]["value"])
        end

        reference = @directory.join("#{label}-reference.pdf")
        viewport = options.each_slice(2).to_h
        dimensions = %w[--width --height].flat_map do |dimension|
          viewport.key?(dimension) ? [
            dimension,
            (viewport[dimension].to_f * 96 / viewport.fetch("--dpi", 96).to_f).to_s
          ] : []
        end

        command("rsvg-convert", "--format=pdf", "--keep-aspect-ratio", *dimensions, "--output", reference, source_path)
        expected_appearance = appearance(reference)
        assert_equal(expected_appearance, appearance(native), label)
        choices = data["parameters"].to_h do |id, definition|
          property = definition["binding"]["property"]
          [id, property == "display" ? "inline" : property.end_with?("color") ? "#336699" : 0.4]
        end

        request = write("#{label}-request.json", choices)
        edited = pdf("style", "#{label}-edited.pdf", native, "--overrides", request)
        actual = JSON.parse(command(@cli, "describe", edited).stdout)["parameters"]
        assert_equal(choices, actual.transform_values { |entry| entry["parameter"]["value"] })
        restored = pdf("reset", "#{label}-reset.pdf", edited)
        assert_equal(expected_appearance, appearance(restored), "#{label}-reset")
        expected = Preservation.read(native)
        assert_equal(expected, Preservation.read(edited), label)
        assert_equal(expected, Preservation.read(restored), label)
      end
    end

    def test_parameter_groups_preserve_arrays_and_sort_unlisted_ids
      source = @directory.join("groups.svg")
      source.write(svg(SHAPE))
      data = declaration({"guides" => "#Guides"})
      data["groups"] = [{"title" => "Ink", "parameters" => %w[guides.stroke-width guides.display]}]
      expected = data["groups"] +
        [
          {
            "title" => "Other controls",
            "parameters" => %w[guides.fill-color guides.fill-opacity guides.stroke-color guides.stroke-opacity]
          }
        ]
      [data["parameters"], data["parameters"].to_a.reverse.to_h].each_with_index do |parameters, index|
        declared = write("groups-#{index}.json", data.merge("parameters" => parameters))
        output = pdf("imprint", "groups-#{index}.pdf", source, "--declaration", declared)
        assert_equal(expected, JSON.parse(command(@cli, "describe", output).stdout)["groups"])
      end
    end

    def test_optional_display_preserves_source_visibility
      %w[inline none].each do |display|
        source = @directory.join("fixed-#{display}.svg")
        source.write(svg(display == "none" ? SHAPE.sub("fill:none", "display:none;fill:none") : SHAPE))
        data = declaration({"guides" => "#Guides"})
        data["parameters"].delete("guides.display")
        data["targets"]["guides"]["display"] = "none" if display == "none"
        native = pdf("imprint", "fixed-#{display}.pdf", source, "--declaration", write("fixed.json", data))
        description = JSON.parse(command(@cli, "describe", native).stdout)
        assert_equal(data.fetch("parameters").keys.sort, description.fetch("parameters").keys.sort)
        reference = @directory.join("fixed-#{display}-reference.pdf")
        command("rsvg-convert", "--format=pdf", "--output", reference, source)
        expected_appearance = appearance(reference)
        assert_equal(expected_appearance, appearance(native), "fixed-#{display}")
        edited = pdf(
          "style",
          "fixed-#{display}-edited.pdf",
          native,
          "--overrides",
          write("fixed-changes.json", {"guides.stroke-color" => "#336699", "guides.fill-opacity" => 0.4})
        )
        assert_equal(expected_appearance, appearance(edited), "fixed-hidden-edited") if display == "none"
        restored = pdf("reset", "fixed-#{display}-reset.pdf", edited)
        assert_equal(expected_appearance, appearance(restored), "fixed-#{display}-reset")
        assert_equal(Preservation.read(native), Preservation.read(edited))
        assert_equal(Preservation.read(native), Preservation.read(restored))
      end
    end

    def test_targets_require_parameter_bindings
      source = @directory.join("unbound.svg")
      source.write(svg(SHAPE))
      data = declaration({"guides" => "#Guides", "unused" => "#Unused"})
      data["parameters"].reject! { |_, parameter| parameter["binding"]["targets"] == ["unused"] }
      failure = command(
        @cli,
        "imprint",
        source,
        "--declaration",
        write("unbound.json", data),
        "--output",
        @directory.join("unbound.pdf"),
        ok: false
      )
      assert_equal("invalid-contract", JSON.parse(failure.stderr)["code"])
      assert_includes(JSON.parse(failure.stderr)["message"], "Every target requires a parameter binding.")
    end

    def test_physical_units_match_css_pixel_dimensions
      physical = @directory.join("physical.svg")
      physical.write(svg(SHAPE, width: "2in", height: "1.5in"))
      declared = write("declaration.json", declaration({"guides" => "#Guides"}))
      native = pdf("imprint", "physical.pdf", physical, "--declaration", declared, "--dpi", "144")
      pixels = @directory.join("pixels.svg")
      pixels.write(svg(SHAPE, width: 192, height: 144))
      equivalent = pdf("imprint", "pixels.pdf", pixels, "--declaration", declared, "--dpi", "144")
      assert_equal(appearance(equivalent), appearance(native), "physical")
      assert_equal(Preservation.read(equivalent), Preservation.read(native))
      assert_equal(
        JSON.parse(command(@cli, "describe", equivalent).stdout),
        JSON.parse(command(@cli, "describe", native).stdout)
      )
      assert_includes(command("pdfinfo", native).stdout, "144 x 108 pts")
    end

    def test_opaque_target_and_parameter_ids_survive_production
      target = "ink\"\\雪/~"
      source = @directory.join("opaque.svg")
      source.write(svg(SHAPE))
      data = declaration({target => "#Guides"})
      id = "#{target}.stroke-opacity"
      data["parameters"][id]["value"] = 0.4
      declared = write("opaque.json", data)
      output = pdf("imprint", "opaque.pdf", source, "--declaration", declared)
      parameters = JSON.parse(command(@cli, "describe", output).stdout)["parameters"]
      assert_equal(data["parameters"].keys.sort, parameters.keys.sort)
      assert_equal(0.4, parameters.fetch(id)["parameter"]["value"])
      assert_equal([target], parameters.fetch(id)["parameter"]["binding"]["targets"])
    end

    def test_css_tokens_cannot_hide_compositing_when_splitting_children
      body = "<g id=\"Parent\" style=\"STYLE\"><g id=\"First\"><path fill=\"none\" stroke=\"red\" stroke-width=\"30\" d=\"M30 60h80\"/></g><g id=\"Other\"><path fill=\"none\" stroke=\"blue\" stroke-width=\"30\" d=\"M60 30v70\"/></g></g>"
      declared = write("compositing.json", declaration({"guides" => "#First"}, fill: false))
      reference = @directory.join("opacity-reference.pdf")
      source = @directory.join("compositing.svg")
      source.write(svg(body.sub("STYLE", "opacity:.5")))
      command("rsvg-convert", "--format=pdf", "--output", reference, source)
      expected_appearance = appearance(reference)
      [
        "opacity:.5",
        "opa\\63ity:.5",
        "\\6f pacity:.5",
        "opa\\000063ity/**/:/**/.5",
        "/* before */ opacity: .5 /* after */"
      ].each_with_index do |css, index|
        [false, true].each do |stylesheet|
          content = stylesheet ? "<style>#Parent { #{css} }</style>" + body.sub(" style=\"STYLE\"", "") : body
            .sub("STYLE") { css }
          source.write(svg(content))
          rendered = @directory.join("css-reference.pdf")
          command("rsvg-convert", "--format=pdf", "--output", rendered, source)
          assert_equal(expected_appearance, appearance(rendered), "css-#{index}-#{stylesheet}")
          output = @directory.join("compositing.pdf")
          result = command(@cli, "imprint", source, "--declaration", declared, "--output", output, ok: false)
          assert_equal("imprinter-error", JSON.parse(result.stderr)["code"])
          refute_path_exists(output)
        end
      end

      source.write(svg(body.sub("STYLE", "/* opacity:.5 */fill:none;stroke-opacity:.5")))
      output = pdf("imprint", "safe-css.pdf", source, "--declaration", declared)
      command("rsvg-convert", "--format=pdf", "--output", reference, source)
      assert_equal(appearance(reference), appearance(output), "safe-css-comments")
      caption = body.sub(" style=\"STYLE\"", "") + "<text id=\"Caption\" x=\"10\" y=\"110\">Text</text>"
      source.write(svg("<style>#Caption { font-family:'monospace' }</style>" + caption))
      command("rsvg-convert", "--format=pdf", "--output", reference, source)
      source.write(svg("<style>#Caption { font-family:'mono\\\nspace' }</style>" + caption))
      output = pdf("imprint", "safe-css-string.pdf", source, "--declaration", declared)
      assert_equal(appearance(reference), appearance(output), "safe-css-string")
      ["#Parent:not(.hidden)", ".opacity:not(.hidden)", ".opa\\63ity:not(.hidden)"].each_with_index do |selector, index|
        content = "<style>#{selector} { fill:none;stroke-opacity:.5 }</style>" +
          body.sub(" style=\"STYLE\"", " class=\"opacity\"")
        source.write(svg(content))
        output = pdf("imprint", "safe-selector-#{index}.pdf", source, "--declaration", declared)
        command("rsvg-convert", "--format=pdf", "--output", reference, source)
        assert_equal(appearance(reference), appearance(output), "safe-css-selector-#{index}")
      end

      ["fill:none;/* unterminated", "fill:rgb(0,0,0", "fill:none;\\", "@import \"remote.css\";"].each do |css|
        source.write(svg(body.sub("STYLE") { css.gsub("\"", "&quot;") }))
        destination = @directory.join("invalid-css.pdf")
        result = command(@cli, "imprint", source, "--declaration", declared, "--output", destination, ok: false)
        assert_equal("imprinter-error", JSON.parse(result.stderr)["code"])
        refute_path_exists(destination)
      end
    end

    def test_unsupported_sources_and_declarations_are_rejected
      invalid = [
        [
          svg(SHAPE.sub("fill:none", "display:none!important;fill:none")),
          declaration({"guides" => "#Guides"}).merge(
            "targets" => {"guides" => {"selectors" => ["#Guides"], "fill" => true, "display" => "none"}}
          )
        ],
        [
          svg("<style>rect:not([id]) {fill:red}</style><rect width=\"160\" height=\"120\"/>" + SHAPE),
          declaration({"guides" => "#Guides"})
        ],
        [svg(SHAPE), {"targets" => {}, "parameters" => {}}],
        [
          svg(SHAPE),
          declaration({"guides" => "#Guides"}).merge(
            "groups" => [{"title" => "Guides", "parameters" => ["guides.display"], "details" => "Missing summary."}]
          )
        ],
        [svg(SHAPE), declaration({"guides" => "#Missing"})],
        [svg(SHAPE.sub("fill:none", "opacity:.5;fill:none")), declaration({"guides" => "#Guides"})],
        ["<!DOCTYPE svg [<!ENTITY x \"bad\">]>" + svg(SHAPE), declaration({"guides" => "#Guides"})],
        [svg(SHAPE.sub("fill:none", "display:none;fill:none")), declaration({"guides" => "#Guides"})],
        [svg(SHAPE.sub("style=", "transform=\"scale(2 1)\" style=")), declaration({"guides" => "#Guides"})],
        [svg(SHAPE.sub("x=\"30\"", "x=\"0\"")), declaration({"guides" => "#Guides"})],
        [svg(SHAPE), declaration({"one" => "#Guides", "two" => "#Guides"})],
        [
          svg(SHAPE.sub("<rect x=\"30\" y=\"30\" width=\"50\" height=\"40\"/>", "<path d=\"M30 30L80 80\"/>")),
          declaration({"guides" => "#Guides"})
        ]
      ]
      invalid.each_with_index do |(source, data), index|
        path = @directory.join("invalid.svg")
        path.write(source)
        declared = write("invalid.json", data)
        output = @directory.join("invalid.pdf")
        result = command(@cli, "imprint", path, "--declaration", declared, "--output", output, ok: false)
        assert_includes(
          %w[invalid-contract imprinter-error unsupported-context],
          JSON.parse(result.stderr)["code"],
          index.to_s
        )
        refute_path_exists(output)
      end

      source = @directory.join("valid.svg")
      source.write(svg(SHAPE))
      duplicate = @directory.join("duplicate.json")
      duplicate.write("{\"targets\":{},\"targets\":{},\"parameters\":{}}")
      output = @directory.join("invalid.pdf")
      failure = command(@cli, "imprint", source, "--declaration", duplicate, "--output", output, ok: false)
      error = JSON.parse(failure.stderr)
      assert_equal("invalid-contract", error["code"])
      assert_equal("declaration", error["source"])
      assert_equal("", error["location"])
      data = declaration({"guides" => "#Guides"})
      data["parameters"]["guides.stroke-width"]["schema"]["default"] = 0.5
      command(@cli, "imprint", source, "--declaration", write("default.json", data), "--output", output, ok: false)
      refute_path_exists(output)
      assert_empty(@directory.glob(".mainz-*"))
    end

    def test_dense_capture_uses_the_embedded_manifest_limit
      shapes = (%w[#000000 #111111] * 6000)
        .map do |color|
          "<rect stroke=\"#{color}\" x=\"30\" y=\"30\" width=\"50\" height=\"40\"/>"
        end
        .join
      source = @directory.join("dense.svg")
      source.write(svg("<g id=\"Guides\" fill=\"none\">#{shapes}</g>"))
      declared = write("declaration.json", declaration({"guides" => "#Guides"}))
      output = pdf("imprint", "dense.pdf", source, "--declaration", declared)
      document = HexaPDF::Document.open(output)
      attachment = document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("mainz.json")[:EF][:F]

      assert_operator(attachment.stream.bytesize, :>, 1024 * 1024)
      assert_operator(attachment.stream.bytesize, :<=, 16 * 1024 * 1024)
    end

    def test_semantic_declarations_reject_incomplete_keys
      source = @directory.join("semantics.svg")
      source.write(svg(SHAPE))
      data = declaration({"guides" => "#Guides"})
      data["parameters"]["guides.stroke-width"]["family"] = "producer"
      output = @directory.join("invalid.pdf")
      failure = command(
        @cli,
        "imprint",
        source,
        "--declaration",
        write("semantics.json", data),
        "--output",
        output,
        ok: false
      )
      error = JSON.parse(failure.stderr)
      assert_equal("invalid-contract", error["code"])
      assert_equal("declaration", error["source"])
      assert_equal("/parameters/guides.stroke-width", error["location"])
      refute_path_exists(output)
    end

    def test_excessive_capture_metadata_is_rejected
      shapes = (%w[#000000 #111111] * 100000)
        .map do |color|
          "<rect stroke=\"#{color}\" x=\"30\" y=\"30\" width=\"50\" height=\"40\"/>"
        end
        .join
      source = @directory.join("large.svg")
      source.write(svg("<g id=\"Guides\" fill=\"none\">#{shapes}</g>"))
      declared = write("declaration.json", declaration({"guides" => "#Guides"}))
      output = @directory.join("invalid.pdf")
      failure = command(@cli, "imprint", source, "--declaration", declared, "--output", output, ok: false)
      assert_equal("limit-exceeded", JSON.parse(failure.stderr)["code"])
      refute_path_exists(output)
    end

    def test_selected_text_and_images_are_rejected
      ["<text x=\"30\" y=\"90\" fill=\"black\" stroke=\"none\">Text</text>", IMAGE].product([false, true]).each do |
          content,
          hidden
        |
        shape = SHAPE.sub("</g>", "#{content}</g>")
        data = declaration({"guides" => "#Guides"})
        if hidden
          shape = shape.sub("fill:none", "display:none;fill:none")
          data["targets"]["guides"]["display"] = "none"
        end

        source = @directory.join("mixed.svg")
        source.write(svg(shape))
        output = @directory.join("mixed.pdf")
        failure = command(
          @cli,
          "imprint",
          source,
          "--declaration",
          write("mixed.json", data),
          "--output",
          output,
          ok: false
        )
        assert_equal(1, failure.status.exitstatus)
        assert_equal("unsupported-context", JSON.parse(failure.stderr)["code"])
        refute_path_exists(output)
      end

      assert_empty(@directory.glob(".mainz-*"))
    end

    def test_rejects_xml_stylesheet_and_xinclude_and_emits_mediabox_for_empty_svg
      stylesheet_svg = @directory.join("xml-stylesheet.svg")
      stylesheet_svg.write(
        "<?xml version=\"1.0\"?>\n" \
        "<?xml-stylesheet type=\"text/css\" href=\"data:text/css,g{opacity:0.5;mix-blend-mode:multiply}\"?>\n" \
        + svg("<g id=\"outer\"><g id=\"inner\"><rect x=\"10\" y=\"10\" width=\"40\" height=\"40\" fill=\"#222\"/></g></g>")
      )
      decl = write("decl-pi.json", declaration({"inner" => "#inner"}))
      result = command(@cli, "imprint", stylesheet_svg, "--declaration", decl, "--output", @directory.join("pi.pdf"), ok: false)
      assert_equal("imprinter-error", JSON.parse(result.stderr)["code"])

      [
        svg("<xi:include xmlns:xi=\"http://www.w3.org/2001/XInclude\" href=\"data:text/xml,%3Cstyle%20xmlns=%22http://www.w3.org/2000/svg%22%3Eg{opacity:0.5}%3C/style%3E\"/><g id=\"inner\"><rect x=\"10\" y=\"10\" width=\"40\" height=\"40\" fill=\"#222\"/></g>"),
        svg("<defs><xi:include xmlns:xi=\"http://www.w3.org/2001/XInclude\" href=\"data:text/xml,%3Cstyle%20xmlns=%22http://www.w3.org/2000/svg%22%3Eg{opacity:0.5}%3C/style%3E\"/></defs><g id=\"inner\"><rect x=\"10\" y=\"10\" width=\"40\" height=\"40\" fill=\"#222\"/></g>")
      ].each_with_index do |markup, index|
        xi_svg = @directory.join("xinclude-#{index}.svg")
        xi_svg.write(markup)
        result = command(@cli, "imprint", xi_svg, "--declaration", decl, "--output", @directory.join("xi-#{index}.pdf"), ok: false)
        assert_equal("imprinter-error", JSON.parse(result.stderr)["code"])
      end

      empty_svg = @directory.join("empty-meta.svg")
      empty_svg.write(svg("<defs/>", width: 160, height: 120))
      meta_decl = write("meta-only.json", {"targets" => {}, "parameters" => {}, "page" => {"name" => "Cover"}})
      emitted = pdf("imprint", "empty-meta.pdf", empty_svg, "--declaration", meta_decl)
      doc = HexaPDF::Document.open(emitted)
      assert_equal([0, 0, 120, 90], doc.pages[0][:MediaBox].map(&:to_f))
    end

    def test_rejects_hidden_inline_display_mix_blend_mode_and_gradient_shading
      hidden_svg = @directory.join("hidden-inline.svg")
      hidden_svg.write(svg(SHAPE.sub("fill:none", "display:none;fill:none")))
      inline_decl = declaration({"guides" => "#Guides"})
      inline_decl["targets"]["guides"]["display"] = "inline"
      result = command(
        @cli,
        "imprint",
        hidden_svg,
        "--declaration",
        write("hidden-inline.json", inline_decl),
        "--output",
        @directory.join("hidden-inline.pdf"),
        ok: false
      )
      assert_equal("imprinter-error", JSON.parse(result.stderr)["code"])

      blend_svg = @directory.join("blend-attr.svg")
      blend_svg.write(svg("<g id=\"Guides\" mix-blend-mode=\"multiply\"><rect x=\"30\" y=\"30\" width=\"50\" height=\"40\" fill=\"#222\"/></g>"))
      result = command(
        @cli,
        "imprint",
        blend_svg,
        "--declaration",
        write("blend-attr.json", declaration({"guides" => "#Guides"})),
        "--output",
        @directory.join("blend-attr.pdf"),
        ok: false
      )
      assert_equal("imprinter-error", JSON.parse(result.stderr)["code"])

      grad_svg = @directory.join("gradient.svg")
      grad_svg.write(
        svg(
          "<defs><linearGradient id=\"g1\"><stop offset=\"0%\" stop-color=\"#000\"/><stop offset=\"100%\" stop-color=\"#fff\"/></linearGradient></defs>" \
          "<g id=\"Guides\"><rect x=\"30\" y=\"30\" width=\"50\" height=\"40\" fill=\"url(#g1)\"/></g>"
        )
      )
      result = command(
        @cli,
        "imprint",
        grad_svg,
        "--declaration",
        write("gradient.json", declaration({"guides" => "#Guides"})),
        "--output",
        @directory.join("gradient.pdf"),
        ok: false
      )
      assert_equal("unsupported-context", JSON.parse(result.stderr)["code"])
    end

    private

    def png_chunk(type, bytes)
      [bytes.bytesize].pack("N") + type.b + bytes.b + [Zlib.crc32(type.b + bytes.b)].pack("N")
    end

    def png
      "\x89PNG\r\n\x1a\n".b +
        png_chunk("IHDR", [1, 1, 8, 2, 0, 0, 0].pack("NNCCCCC")) +
        png_chunk("IDAT", Zlib::Deflate.deflate("\0\0\0\0".b)) +
        png_chunk("IEND", "")
    end

    def appearance(path)
      [150, 300].to_h do |dpi|
        pixels = Mainz.run("pdftoppm", "-r", dpi, "-singlefile", path)
        assert(pixels.start_with?("P6\n"), "Missing PPM image for #{path.basename} at #{dpi} DPI")
        [dpi, Digest::SHA256.hexdigest(pixels)]
      end
    end

    def cases
      [
        ["closed", svg(SHAPE), declaration({"guides" => "#Guides"}), []],
        ["hidden", svg(SHAPE.sub("fill:none", "display:none;fill:none")), declaration({"guides" => "#Guides"}), []],
        [
          "mixed",
          svg(SHAPE.sub("</g>", "<path stroke=\"red\" stroke-opacity=\"0.4\" d=\"M90 40h30v30h-30z\"/></g>")),
          declaration({"guides" => "#Guides"}),
          []
        ],
        [
          "order-text",
          svg(
            "<rect width=\"160\" height=\"120\" fill=\"white\"/>" +
              SHAPE +
              "<text x=\"15\" y=\"100\">PDF glyphs</text>" +
              IMAGE
          ),
          declaration({"guides" => "#Guides"}),
          []
        ],
        [
          "uses",
          svg(
            "<defs><g id=\"Tile\" style=\"fill:none;stroke:black\"><rect x=\"0\" y=\"0\" width=\"20\" height=\"20\"/></g></defs><g id=\"Tiles\"><use id=\"A\" class=\"row\" href=\"#Tile\" x=\"30\" y=\"30\"/><use id=\"B\" class=\"col\" href=\"#Tile\" x=\"70\" y=\"60\"/><use id=\"C\" class=\"row\" href=\"#Tile\" x=\"100\" y=\"30\"/></g>"
          ),
          declaration({"rows" => "#Tiles > use.row", "cols" => "#Tiles > use.col"}),
          []
        ],
        [
          "clip-scale",
          svg(
            "<defs><clipPath id=\"Clip\"><rect width=\"160\" height=\"120\"/></clipPath></defs>" +
              SHAPE.sub("style=", "clip-path=\"url(#Clip)\" transform=\"translate(10 10) scale(.8)\" style=")
          ),
          declaration({"guides" => "#Guides"}),
          %w[--width 320 --height 240 --dpi 144]
        ],
        [
          "existing-fill",
          svg(SHAPE.sub("fill:none", "fill:blue;fill-opacity:.3")),
          declaration({"guides" => "#Guides"}),
          []
        ],
        [
          "id-css",
          svg(
            "<style>use:not([id]) {stroke:red;stroke-width:3}</style><defs><g id=\"Tile\" fill=\"none\"><rect x=\"30\" y=\"30\" width=\"40\" height=\"40\"/></g></defs><g id=\"Guides\" stroke=\"black\"><use href=\"#Tile\"/></g>"
          ),
          declaration({"guides" => "#Guides"}),
          []
        ],
        ["physical", svg(SHAPE, width: "2in", height: "1.5in"), declaration({"guides" => "#Guides"}), %w[--dpi 144]],
        ["long-style", svg(SHAPE.sub("style=\"", "style=\"" + " " * 100_000)), declaration({"guides" => "#Guides"}), []],
        [
          "structural-style",
          svg(
            "<style>svg > g:last-child {stroke:red}</style><g id=\"Guides\" fill=\"none\"><rect x=\"30\" y=\"30\" width=\"50\" height=\"40\"/></g>"
          ),
          declaration({"guides" => "#Guides"}),
          []
        ]
      ]
    end

    def declaration(targets, fill: true)
      properties = %w[display stroke-opacity stroke-color stroke-width]
      properties += %w[fill-color fill-opacity] if fill
      parameters = targets
        .keys
        .flat_map do |target|
          properties.map do |property|
            schema = case property
            when "stroke-width"
              {"type" => "number", "minimum" => 0.05, "maximum" => 0.7}
            when /opacity\z/
              {"type" => "number", "minimum" => 0, "maximum" => 1}
            when "display"
              {"type" => "string", "enum" => %w[inline none]}
            else
              {"type" => "string", "pattern" => "^#[0-9a-fA-F]{6}$"}
            end

            [
              "#{target}.#{property}",
              {"schema" => schema, "binding" => {"targets" => [target], "property" => property}}
            ]
          end
        end
        .to_h
      {
        "targets" => targets.transform_values { |selector| {"selectors" => [selector], "fill" => fill} },
        "parameters" => parameters
      }
    end

    def pdf(command, name, *arguments)
      output = @directory.join(name)
      FileUtils.rm_f(output)
      command(@cli, command, *arguments, "--output", output)
      command("qpdf", "--check", output)
      output
    end

    def command(*arguments, ok: true)
      result = Mainz.capture(*arguments)
      assert_equal(ok, result.status.success?, "#{arguments.inspect}: #{result.stdout}#{result.stderr}")
      result
    end

    def svg(content, width: 160, height: 120)
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"#{width}\" height=\"#{height}\">#{content}</svg>"
    end

    def write(name, value)
      path = @directory.join(name)
      path.write(JSON.generate(value))
      path
    end
  end
end
