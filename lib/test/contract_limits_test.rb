# frozen_string_literal: true

require_relative "contract_helper"

module Mainz
  class ContractLimitsTest < Minitest::Test
    include ContractHelper

    def test_shared_input_byte_limit_counts_bindings_once
      source = large_input_fixture
      request = {
        "version" => 1,
        "sources" => {"a" => {"input" => "book", "overrides" => {}}, "b" => {"input" => "book", "overrides" => {}}},
        "parts" => [{"pages" => [{"source" => "a", "page" => 0}, {"source" => "b", "page" => 1}]}]
      }
      write("inputs.json", {"book" => source.to_s})
      output, = compose(request, "large-shared.pdf")
      assert_equal(2, describe(output)["pageCount"])
      recipe = request.merge(
        "inputs" => {"book" => {"sha256" => Digest::SHA256.file(source).hexdigest}},
        "sources" => {"a" => {"input" => "book"}, "b" => {"input" => "book"}}
      )
      recipe_output = file("large-recipe.pdf")
      FileUtils.rm_f(recipe_output)
      command(
        @cli,
        "apply",
        write("large-recipe.json", recipe),
        "--inputs",
        file("inputs.json"),
        "--output",
        recipe_output
      )
      assert_equal(output.binread, recipe_output.binread)
      request["sources"]["b"]["input"] = "other"
      write("inputs.json", {"book" => source.to_s, "other" => source.to_s})
      _, failure = compose(request, "large-distinct.pdf", ok: false)
      assert_equal("limit-exceeded", JSON.parse(failure.stderr)["code"])
    end

    def test_error_context_does_not_use_request_string_limits
      id = "x" * 4096
      request = write("long-unknown-id.json", {id => 0.2})
      failure = command(@cli, "style", @source, "--overrides", request, "--output", file("long-id.pdf"), ok: false)
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

    def test_decoded_content_and_manifest_limits_are_enforced
      fixture(
        file("decode-limit.pdf"),
        pdf_objects: -> (objects, stream) {
          objects[4] = stream.call("/Filter /FlateDecode", Zlib::Deflate.deflate(" " * (32 * 1024 * 1024 + 1)))
        }
      )
      assert_equal("limit-exceeded", failure_code(file("decode-limit.pdf")))
      fixture(file("book-json.pdf"), pdf_objects: padded_manifest(8 * 1024 * 1024 + 1))
      command(@cli, "verify", file("book-json.pdf"))
      fixture(file("manifest-limit.pdf"), pdf_objects: padded_manifest(16 * 1024 * 1024 + 1))
      assert_equal("limit-exceeded", failure_code(file("manifest-limit.pdf")))
    end

    def test_shared_record_expansion_obeys_record_and_text_limits
      expanded_fixture
      assert_equal("limit-exceeded", failure_code(file("expanded-limit.pdf")))
      expanded_text_fixture
      assert_equal("limit-exceeded", failure_code(file("expanded-text-limit.pdf")))
    end

    def test_rejects_png_predictor_bomb_and_inline_signatures_and_oversized_labels
      [2_147_483_647, 20_000_000].each_with_index do |columns, index|
        predictor = file("predictor-bomb-#{index}.pdf")
        fixture(
          predictor,
          pdf_objects: -> (objects, _stream) {
            compressed = Zlib::Deflate.deflate("\x00\x00")
            objects[4] = "<< /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns #{columns} >> /Length #{compressed.bytesize} >>\nstream\n#{compressed}\nendstream"
          }
        )
        assert_equal("limit-exceeded", failure_code(predictor))
      end

      inline_sig = file("inline-signature.pdf")
      fixture(
        inline_sig,
        pdf_objects: -> (objects, _stream) {
          objects[0] = objects[0].sub(
            "/Names",
            "/AcroForm << /Fields [ << /FT /Sig /T (S) /V << /Type /Sig /ByteRange [0 1 2 3] /Contents <00> >> >> ] >> /Names"
          )
        }
      )
      assert_equal("unsupported-context", failure_code(inline_sig))

      sig_flags = file("sig-flags.pdf")
      fixture(
        sig_flags,
        pdf_objects: -> (objects, _stream) {
          objects[0] = objects[0].sub("/Names", "/AcroForm << /SigFlags 3 /Fields [] >> /Names")
        }
      )
      assert_equal("unsupported-context", failure_code(sig_flags))

      huge_prefix = file("huge-label-prefix.pdf")
      doc = HexaPDF::Document.new
      doc.pages.add
      doc.catalog[:PageLabels] = {Nums: [0, {P: "x" * 5000, S: :D}]}
      doc.write(huge_prefix.to_s)
      assert_equal("limit-exceeded", failure_code(huge_prefix))

      huge_alpha = file("huge-label-alpha.pdf")
      doc = HexaPDF::Document.new
      doc.pages.add
      doc.catalog[:PageLabels] = {Nums: [0, {S: :A, St: 1_000_000}]}
      doc.write(huge_alpha.to_s)
      assert_equal("limit-exceeded", failure_code(huge_alpha))
    end

    def test_compose_enforces_record_limit_on_repeated_pages
      source = file("many-records.pdf")
      record_count = 505
      fixture(
        source,
        -> (data) {
          base_record = data["regions"]["filled"]["records"][0]
          data["regions"]["filled"]["records"] = Array.new(record_count) do |index|
            base_record.merge("marker" => "Fill#{index}")
          end
        },
        content: <<~PDF,
          /Span BMC
          /Figure /Rows BDC q /Row Do Q EMC
          /Figure /Guides BDC /Figure /GuidePaint BDC q +.2000000000000000000 w 0.2 G 0 g /Hidden gs
          10 100 40 40 re 20 110 20 20 re S Q EMC EMC
          /Figure /Fills BDC
          #{Array.new(record_count) { |index| "/Figure /Fill#{index} BDC q +.2000000000000000000 w 0.2 G 0 g /Filled gs 140 100 20 20 re 145 105 10 10 re f* Q EMC" }.join("\n")}
          EMC
          EMC
        PDF
        pdf_objects: -> (objects, _stream) {
          extra = Array.new(record_count) { |index| "/Fill#{index} <<>>" }.join(" ")
          objects[2] = objects[2].sub("/FillPaint <<>>", "/FillPaint <<>> #{extra}")
        }
      )
      assert_equal(true, command(@cli, "verify", source).status.success?)
      write("inputs.json", {"book" => source.to_s})
      plan = {
        "version" => 1,
        "sources" => {"a" => {"input" => "book", "overrides" => {}}},
        "parts" => [{"pages" => [{"source" => "a", "page" => 0}], "copies" => 1000}]
      }
      _, result = compose(plan, "too-many-records.pdf", ok: false)
      assert_equal("limit-exceeded", JSON.parse(result.stderr)["code"])
    end
  end
end
