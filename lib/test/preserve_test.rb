# frozen_string_literal: true

require "minitest/autorun"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::Preservation)

module Mainz
  class PreservationTest < Minitest::Test
    CONTENT = "1 0 0 1 0 0 cm 10.000 10 20 20 re W n 10.000 10 20 20 re S " \
      "BT /F 10 Tf (Text) Tj ET /Image Do /Form Do"

    def setup
      @directory = Pathname(Dir.mktmpdir("inspector-", Mainz.workspace("tmp/test/inspector").to_s))
      @original = @directory.join("original.pdf")
      @candidate = @directory.join("candidate.pdf")
      fixture(@original)
      @expected = Preservation.read(@original)
    end

    def teardown
      FileUtils.remove_entry(@directory)
    end

    def test_paint_changes_preserve_protected_content
      fixture(@candidate, content: CONTENT.sub("re S", "re f"))
      assert_equal(@expected, Preservation.read(@candidate))
      assert_equal("10.000 10 20 20 re", @expected[0][:geometry][0])
      assert_equal(2, @expected[0][:geometry].length)
      %i[clips fonts images texts transforms].each { |key| refute_empty(@expected[0][key]) }
    end

    def test_geometry_clipping_transforms_and_text_changes_are_found
      [
        ["10.000", "10"],
        ["20 20 re W", "20 21 re W"],
        ["1 0 0 1 0 0 cm", "1 0 0 1 1 0 cm"],
        ["(Text)", "(Other)"]
      ].each do |before, after|
        fixture(@candidate, content: CONTENT.sub(before, after))
        refute_equal(@expected, Preservation.read(@candidate), "#{before} -> #{after}")
      end
    end

    def test_graphics_scope_changes_are_found
      [
        ["q 2 0 0 2 0 0 cm 5 5 10 10 re f Q 30 30 10 10 re f", "2 0 0 2 0 0 cm q 5 5 10 10 re f Q 30 30 10 10 re f"],
        [
          "q 5 5 20 20 re W n 10 10 30 30 re f Q 50 50 10 10 re f",
          "5 5 20 20 re W n q 10 10 30 30 re f Q 50 50 10 10 re f"
        ]
      ].each do |original, candidate|
        fixture(@original, content: original)
        fixture(@candidate, content: candidate)
        refute_equal(Preservation.read(@original), Preservation.read(@candidate))
      end

      fixture(@candidate, content: "q #{CONTENT} Q")
      assert_equal(@expected, Preservation.read(@candidate))
    end

    def test_unbalanced_graphics_state_is_rejected
      ["q", "Q", "10 10 20 20 re W", "q " * 65].each do |content|
        fixture(@candidate, content: content)
        assert_raises(RuntimeError) { Preservation.read(@candidate) }
      end
    end

    def test_font_and_image_changes_are_found
      fixture(@candidate, font: "other font")
      refute_equal(@expected, Preservation.read(@candidate))
      fixture(@candidate, image: "\x81".b)
      refute_equal(@expected, Preservation.read(@candidate))
    end

    def test_page_and_form_geometry_changes_are_found
      [
        {MediaBox: [0, 0, 110, 100]},
        {CropBox: [0, 0, 90, 100]},
        {BleedBox: [0, 0, 90, 100]},
        {TrimBox: [0, 0, 90, 100]},
        {ArtBox: [0, 0, 90, 100]},
        {Rotate: 90},
        {UserUnit: 2}
      ].each do |attributes|
        fixture(@candidate, page: attributes)
        refute_equal(@expected, Preservation.read(@candidate), attributes.inspect)
      end

      fixture(@candidate, form: {Matrix: [1, 0, 0, 1, 5, 0]})
      refute_equal(@expected, Preservation.read(@candidate))
      fixture(@candidate, form: {Matrix: [1, 0, 0, 1, 0, 0]})
      refute_equal(@expected, Preservation.read(@candidate))
      fixture(@candidate, form: {BBox: [0, 0, 90, 100]})
      refute_equal(@expected, Preservation.read(@candidate))
    end

    def test_inline_image_changes_are_found
      fixture(@original, content: CONTENT + " q BI /W 1 /H 1 /BPC 8 /CS /G ID 0 EI Q")
      fixture(@candidate, content: CONTENT + " q BI /W 1 /H 1 /BPC 8 /CS /G ID 1 EI Q")
      refute_equal(Preservation.read(@original), Preservation.read(@candidate))
    end

    def test_incomplete_content_is_rejected
      fixture(@candidate, content: "10 20")
      assert_raises(HexaPDF::MalformedPDFError) { Preservation.read(@candidate) }
    end

    private

    def fixture(path, content: CONTENT, font: "font bytes", image: "\x80".b, page: {}, form: {})
      document = HexaPDF::Document.new
      sheet = document.pages.add([0, 0, 100, 100])
      page.each { |key, value| sheet[key] = value }
      sheet[:Contents] = document.add({}, stream: content)
      program = document.add({}, stream: font)
      descriptor = document.add({FontFile: program})
      bitmap = document.add({Subtype: :Image}, stream: image)
      drawing = document.add(
        {Subtype: :Form, BBox: [0, 0, 100, 100], Resources: {}, **form},
        stream: "10.000 10 20 20 re S"
      )
      sheet[:Resources] = {Font: {F: {FontDescriptor: descriptor}}, XObject: {Image: bitmap, Form: drawing}}
      document.write(path.to_s, validate: false, optimize: false, compact: false)
    end
  end
end
