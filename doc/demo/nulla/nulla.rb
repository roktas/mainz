#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"

megic = File.expand_path(ARGV.fetch(0))
cli = File.expand_path(ARGV.fetch(1))
$LOAD_PATH.unshift(File.join(megic, "lib"))
require "megic"

def command(*arguments)
  out, err, status = Open3.capture3(*arguments)
  raise "#{arguments.first}: #{err}" unless status.success?
  out
end

directory = File.expand_path("../../../.local/var/demo/nulla", __dir__)
FileUtils.mkdir_p(directory)
files = {"book" => "dolor", "guides" => "minim", "crossings" => "culpa"}
files.transform_values! do |name|
  generated = File.expand_path("../../../.local/var/demo/#{name}/#{name}.pdf", __dir__)
  fixture = name == "dolor" ? "#{name}.pdf" : "recipe/#{name}.pdf"
  File.exist?(generated) ? generated : File.expand_path("../../../web/test/fixtures/#{fixture}", __dir__)
end
bindings = File.join(directory, "inputs.json")
File.write(bindings, JSON.generate(files))
aligned = File.join(directory, "aligned.json")
command(cli, "align", File.join(__dir__, "nulla.json"), "--inputs", bindings, "--output", aligned, "--force")
recipe = JSON.parse(File.read(aligned))
files.each do |id, path|
  document = HexaPDF::Document.open(path)
  xml = Nokogiri::XML(document.catalog[:Metadata].stream) { |config| config.strict.nonet }
  xmp = xml.xpath("//*[local-name()='Description']/*").to_h do |node|
    values = node.xpath(".//*[local-name()='li']").map(&:text)
    ["#{node.namespace.prefix}:#{node.name}".downcase, values.empty? ? node.text : values.join(", ")]
  end
  input = recipe.fetch("inputs").fetch(id)
  input["title"] = xmp.fetch("dc:title")
  input["xmp"] = xmp
  cover_page = Integer(xmp.fetch("mainz:coverpage", "1"))
  prefix = File.join(directory, id)
  command("pdftoppm", "-f", cover_page.to_s, "-l", cover_page.to_s, "-singlefile", "-scale-to", "512", "-png", path, prefix)
  input["cover"] = "data:image/png;base64,#{[File.binread("#{prefix}.png")].pack("m0")}"
  raise "Cover exceeds the Recipe limit" if input.fetch("cover").bytesize > 256 * 1024
end
output = File.join(directory, "nulla.json")
staged = File.join(directory, "aligned-covers.json")
File.write(staged, JSON.pretty_generate(recipe) + "\n")
command(cli, "resolve", staged, "--inputs", bindings)
File.rename(staged, output)
puts(JSON.generate(output:, inputs: files.keys))
