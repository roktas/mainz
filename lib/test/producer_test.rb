# frozen_string_literal: true

require "minitest/autorun"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::Preservation)

module Mainz
  class ProducerTest < Minitest::Test
    IMAGE = "<image x=\"30\" y=\"90\" width=\"20\" height=\"20\" href=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM/////w8AH+4F+7C4l8kAAAAASUVORK5CYII=\"/>"
    SHAPE = "<g id=\"Guides\" style=\"fill:none;stroke:black;stroke-width:1\"><rect x=\"30\" y=\"30\" width=\"50\" height=\"40\"/></g>"

    def setup
      @directory = Pathname(Dir.mktmpdir("producer-", Mainz.workspace("tmp/test/producer").to_s))
      @cli = File.expand_path(ENV.fetch("MAINZ_CLI"))
    end

    def teardown
      FileUtils.remove_entry(@directory)
    end

    def test_production_preserves_rendering_and_declared_styles
      cases.each do |label, source, data, options|
        if label == "hidden"
          data["targets"]["guides"]["display"] = "none"
          data["parameters"]["guides.stroke-opacity"]["value"] = 0.15
        end

        data["groups"] = [{"title" => "Visibility", "parameters" => [data["parameters"].keys.first]}]
        ids = data["parameters"].keys
        data["profileSets"] = [
          {
            "id" => "print",
            "name" => "Print",
            "parameters" => ids,
            "profiles" => [
              {"id" => "original", "name" => "Original", "overrides" => {}},
              {"id" => "lighter", "name" => "Lighter", "overrides" => {ids[1] => 0.3}}
            ]
          }
        ]
        source_path = @directory.join("#{label}.svg")
        source_path.write(source)
        declared = write("#{label}.json", data)
        native = pdf("produce", "#{label}-native.pdf", source_path, "--declaration", declared, *options)
        summary = JSON.parse(command(@cli, "describe", native).stdout)
        assert_equal(1, summary["pageCount"], label)
        assert_equal(data["parameters"].keys.sort, summary["parameters"].keys.sort, label)
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
        appearance(reference, native, label)
        choices = data["parameters"].to_h do |id, definition|
          property = definition["binding"]["property"]
          [id, property == "display" ? "inline" : property.end_with?("color") ? "#336699" : 0.4]
        end

        request = write("#{label}-request.json", choices)
        edited = pdf("apply", "#{label}-edited.pdf", native, "--request", request)
        actual = JSON.parse(command(@cli, "describe", edited).stdout)["parameters"]
        assert_equal(choices, actual.transform_values { |entry| entry["parameter"]["value"] })
        restored = pdf("reset", "#{label}-reset.pdf", edited)
        appearance(reference, restored, "#{label}-reset")
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
        output = pdf("produce", "groups-#{index}.pdf", source, "--declaration", declared)
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
        native = pdf("produce", "fixed-#{display}.pdf", source, "--declaration", write("fixed.json", data))
        description = JSON.parse(command(@cli, "describe", native).stdout)
        assert_equal(data.fetch("parameters").keys.sort, description.fetch("parameters").keys.sort)
        reference = @directory.join("fixed-#{display}-reference.pdf")
        command("rsvg-convert", "--format=pdf", "--output", reference, source)
        appearance(reference, native, "fixed-#{display}")
        edited = pdf(
          "apply",
          "fixed-#{display}-edited.pdf",
          native,
          "--request",
          write("fixed-changes.json", {"guides.stroke-color" => "#336699", "guides.fill-opacity" => 0.4})
        )
        appearance(reference, edited, "fixed-hidden-edited") if display == "none"
        restored = pdf("reset", "fixed-#{display}-reset.pdf", edited)
        appearance(reference, restored, "fixed-#{display}-reset")
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
        "produce",
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
      native = pdf("produce", "physical.pdf", physical, "--declaration", declared, "--dpi", "144")
      pixels = @directory.join("pixels.svg")
      pixels.write(svg(SHAPE, width: 192, height: 144))
      equivalent = pdf("produce", "pixels.pdf", pixels, "--declaration", declared, "--dpi", "144")
      appearance(equivalent, native, "physical")
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
      output = pdf("produce", "opaque.pdf", source, "--declaration", declared)
      parameters = JSON.parse(command(@cli, "describe", output).stdout)["parameters"]
      assert_equal(data["parameters"].keys.sort, parameters.keys.sort)
      assert_equal(0.4, parameters.fetch(id)["parameter"]["value"])
      assert_equal([target], parameters.fetch(id)["parameter"]["binding"]["targets"])
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
        result = command(@cli, "produce", path, "--declaration", declared, "--output", output, ok: false)
        assert_includes(
          %w[invalid-contract producer-error unsupported-context],
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
      failure = command(@cli, "produce", source, "--declaration", duplicate, "--output", output, ok: false)
      error = JSON.parse(failure.stderr)
      assert_equal("invalid-contract", error["code"])
      assert_equal("declaration", error["source"])
      assert_equal("", error["location"])
      data = declaration({"guides" => "#Guides"})
      data["parameters"]["guides.stroke-width"]["schema"]["default"] = 0.5
      command(@cli, "produce", source, "--declaration", write("default.json", data), "--output", output, ok: false)
      refute_path_exists(output)
      assert_empty(@directory.glob(".mainz-*"))
    end

    def test_excessive_paint_records_are_rejected
      shapes = (%w[#000000 #111111] * 6000)
        .map do |color|
          "<rect stroke=\"#{color}\" x=\"30\" y=\"30\" width=\"50\" height=\"40\"/>"
        end
        .join
      source = @directory.join("large.svg")
      source.write(svg("<g id=\"Guides\" fill=\"none\">#{shapes}</g>"))
      declared = write("declaration.json", declaration({"guides" => "#Guides"}))
      output = @directory.join("invalid.pdf")
      failure = command(@cli, "produce", source, "--declaration", declared, "--output", output, ok: false)
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
          "produce",
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

    private

    def appearance(left, right, label)
      [150, 300].each do |dpi|
        prefixes = [0, 1].map { |index| @directory.join("#{label}-#{dpi}-#{index}") }
        [left, right].zip(prefixes).each { |path, prefix|
          command("pdftoppm", "-r", dpi, "-singlefile", "-png", path, prefix)
        }
        assert_equal(File.binread("#{prefixes[0]}.png"), File.binread("#{prefixes[1]}.png"), "#{label} at #{dpi} DPI")
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
