#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"

megic = File.expand_path(ARGV.fetch(0))
cli = File.expand_path(ARGV.fetch(1))
$LOAD_PATH.unshift(File.join(megic, "lib"))
require "megic"
require File.join(megic, "test/support/profiles")

output = File.expand_path(ARGV.fetch(2, File.expand_path("../../../.local/var/demo/dolor/dolor.pdf", __dir__)))
directory = File.join(File.dirname(output), ".local")
FileUtils.mkdir_p(directory)

def command(*arguments)
  out, err, status = Open3.capture3(*arguments)
  raise "#{arguments.first}: #{err}" unless status.success?
  out
end

def sample_declaration(declaration, watermark)
  data = JSON.parse(JSON.generate(declaration))
  fixed = %w[guides-marks guides-frame]
  data.fetch("targets").reject! { |id, _| fixed.include?(id) }
  data.fetch("parameters").reject! { |_, parameter| parameter.fetch("binding").fetch("targets").intersect?(fixed) }
  parameters = data.fetch("parameters")
  objects = {
    "Pattern" => "Full sheet or first row/column.",
    "Repeats" => "Lighter repeats after the first row/column.",
    "Slants" => "Stroke slant guides.",
    "Angles" => "Angles at the page edge.",
    "Minors" => "Lines between main guides.",
    "Majors" => "Main guides for stroke alignment.",
    "Halves" => "Half-height alignment guides.",
    "Header" => "Space for practice notes."
  }
  properties = {
    "fill-color" => "Inside closed shapes.",
    "fill-opacity" => "0% transparent. 100% opaque.",
    "stroke-color" => "Outline color.",
    "stroke-opacity" => "0% transparent. 100% opaque.",
    "stroke-width" => "Outline thickness in mm."
  }
  parameters.each_value do |parameter|
    schema = parameter.fetch("schema")
    property = parameter.fetch("binding").fetch("property")
    schema["description"] = property == "display" ? objects.fetch(schema.fetch("title")) : properties.fetch(property)
  end

  data.fetch("groups").each do |group|
    group.fetch("parameters").select! { parameters.key?(it) }
    group["description"] = {
      "Patterns" => "Practice shapes and repeats.",
      "Guides" => "Stroke alignment guides.",
      "Margins" => "Page elements above and below the practice area."
    }.fetch(group.fetch("title"))
  end

  data.fetch("profileSets").each do |set|
    set.fetch("parameters").select! { parameters.key?(it) }
    set.fetch("profiles").each do |profile|
      overrides = profile.fetch("overrides")
      overrides.select! { |id, _| parameters.key?(id) }
      next unless profile.fetch("id") == "inkjet"

      profile["description"] = "Finer guides and soft blue pattern fills."
      overrides.each_key do |id|
        overrides[id] = "#6B7F99" if id.match?(/\A(?:pattern|partial)-fill-color\z/)
      end
    end
  end

  %w[targets parameters].each { |key| data.fetch(key).merge!(watermark.fetch(key)) }
  data.fetch("groups").concat(watermark.fetch("groups"))
  semantic_declaration(data)
end

def semantic_declaration(data)
  data.fetch("parameters").each do |id, parameter|
    parameter.merge!("family" => "megic", "key" => id)
  end

  data.fetch("profileSets", []).each { it["family"] = "megic" }
  data
end

def sample_svg(svg, watermark)
  svg.sub("</svg>", "#{watermark}</svg>")
end

watermark_svg = File.read(File.join(__dir__, "dolor.svg"))
watermark = watermark_svg.sub(/\A<svg[^>]*>/, "").sub(%r{</svg>\s*\z}, "")
watermark_declaration = JSON.parse(File.read(File.join(__dir__, "dolor.json")))
outline = watermark.sub("fill-opacity=\".18\"", "fill-opacity=\"0\"")

codes = %w[
  ital-guid-79a4-wxgx
  ital-cros-79a4-wxgf
  ital-cros-79a4-wxgr
]

path = File.join(directory, "prepared.pdf")
reference = File.join(directory, "native.pdf")
inkjet_reference = File.join(directory, "inkjet-native.pdf")
outline_reference = File.join(directory, "outline-native.pdf")
cover_reference = File.join(directory, "cover-edited-native.pdf")
native = []
inkjet = []
outlines = []
metadata = nil
Megic::Task.with_source(megic, shared: true) do
  catalog = Megic::Catalog.load(root: megic)
  book = catalog.fetch("ital-book-79a4-wxga")
  metadata = catalog
    .rdf(book)
    .merge(title: "Italic Strokes", description: "A four-page sample of Italic stroke practice worksheets.")
  cover_svg = Megic::Make.new(catalog:).cover(book)
  cover_declaration = JSON.parse(JSON.generate(watermark_declaration))
  cover_declaration["page"] = {"name" => "COVER"}
  cover_declaration.fetch("targets")["cover"] = {"selectors" => %w[#RibbonFill #Picture]}
  cover_declaration.fetch("parameters")["cover-fill-color"] = {
    "schema" => {"type" => "string", "title" => "Cover", "description" => "Ribbon and motif color."},
    "binding" => {"targets" => ["cover"], "property" => "fill-color"},
    "value" => "##{book.fetch(:color)}".upcase
  }
  cover_declaration.fetch("groups").unshift(
    {"title" => "Cover", "description" => "Ribbon and motifs.", "parameters" => ["cover-fill-color"]}
  )
  semantic_declaration(cover_declaration)
  cover, native_cover, outline_cover, blue_cover = %w[cover cover-native cover-outline cover-blue-native].map do |name|
    declaration = name == "cover" ? cover_declaration : nil
    stamp = name == "cover-outline" ? outline : watermark
    svg = cover_svg.sub("</svg>", "#{stamp}</svg>")
    svg = svg.gsub("##{book.fetch(:color)}", "#21478e") if name == "cover-blue-native"
    target = File.join(directory, "#{name}.pdf")
    Sevgi::Sundries::Export.call(svg, target, declaration:, fallback: false)
    target
  end

  pages = codes.map do |code|
    product = catalog.fetch(code)
    drawing = catalog.render(product)
    svg = sample_svg(drawing.svg, watermark)
    page = File.join(directory, "#{code}.pdf")
    Sevgi::Sundries::Export.call(
      svg,
      page,
      declaration: sample_declaration(drawing.declaration, watermark_declaration),
      fallback: false
    )
    Megic::Pdf.normalize(page, shell: Sevgi::F)
    original = File.join(directory, "#{code}-native.pdf")
    Sevgi::Sundries::Export.call(svg, original)
    native << original
    original = File.join(directory, "#{code}-outline-native.pdf")
    Sevgi::Sundries::Export.call(sample_svg(drawing.svg, outline), original)
    outlines << original
    css = reference_css("inkjet", product.fetch(:family)).gsub("#C0C0C0", "#6B7F99")
    # Fixed marks and frame retain their authored Outlined paint in both profiles.
    fixed_styles = drawing.svg.scan(/^\s*\.(?:mark|frame)\s*\{[^}]*\}/)
    raise "Sample must declare both fixed guide styles" unless fixed_styles.size == 2
    fixed_styles.map! { |style| style.gsub(";", " !important;") }
    inkjet_svg = drawing.svg.sub("</svg>", "<style>#{css}\n#{fixed_styles.join("\n")}</style></svg>")
    inkjet_svg = sample_svg(inkjet_svg, watermark)
    original = File.join(directory, "#{code}-inkjet-native.pdf")
    Sevgi::Sundries::Export.call(inkjet_svg, original)
    inkjet << original
    page
  end

  Megic::Pdf.unite([cover, *pages], path, export: Sevgi::Sundries::Export)
  Megic::Pdf.unite([native_cover, *native], reference, export: Sevgi::Sundries::Export)
  Megic::Pdf.unite([native_cover, *inkjet], inkjet_reference, export: Sevgi::Sundries::Export)
  Megic::Pdf.unite([outline_cover, *outlines], outline_reference, export: Sevgi::Sundries::Export)
  Megic::Pdf.unite([blue_cover, *native], cover_reference, export: Sevgi::Sundries::Export)
end

[path, reference, inkjet_reference, outline_reference, cover_reference].each { |pdf|
  Megic::Pdf.normalize(pdf, shell: Sevgi::F)
}

Tempfile.create([".megic-pdf-", ".pdf"], directory) do |temporary|
  temporary.close
  HexaPDF::Document.open(path) do |document|
    attachment = document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("mainz.json")[:EF][:F]
    manifest = JSON.parse(attachment.stream)
    manifest.fetch("groups").sort_by! { %w[Cover Patterns Guides Margins Watermark].index(it.fetch("title")) }
    attachment.stream = JSON.generate(manifest)
    document.write(temporary.path, validate: false, update_fields: false)
  end

  File.rename(temporary.path, path)
end

Sevgi::Sundries::Export.metadata!(path, **metadata)
Megic::Pdf.normalize(path, shell: Sevgi::F)
command("qpdf", "--check", path)
command(cli, "verify", path)
FileUtils.cp(path, output)
puts(JSON.generate(output: output, pages: 4))
