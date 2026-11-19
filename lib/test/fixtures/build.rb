#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "hexapdf"
require "json"
require "open3"
require "tmpdir"

root = File.expand_path("../../..", __dir__)
cli = File.expand_path(ARGV.fetch(0, File.join(root, ".local/var/cpp/build/native/mainz")))
output = File.expand_path(ARGV.fetch(1, File.join(root, ".local/var/fixtures/recipe")))
FileUtils.mkdir_p(File.dirname(output))
directory = Dir.mktmpdir("recipe-", File.dirname(output))

def command(*arguments)
  out, err, status = Open3.capture3(*arguments.map(&:to_s))
  raise "#{arguments.first}: #{err}" unless status.success?
  out
end

def revise(source, target)
  document = HexaPDF::Document.open(source)
  attachment = document.catalog[:Names][:EmbeddedFiles].each_entry.to_h.fetch("mainz.json")[:EF][:F]
  manifest = JSON.parse(attachment.stream)
  yield document, manifest
  attachment.stream = JSON.generate(manifest)
  document.write(target, update_fields: false)
end

begin
  declaration = JSON.parse(File.read(File.join(__dir__, "declaration.json")))
  pages = %w[Cover Guides Practice].each_with_index.map do |name, index|
    data = declaration.merge("page" => {"name" => name})
    path = File.join(directory, "page-#{index}.json")
    File.write(path, JSON.generate(data))
    pdf = File.join(directory, "page-#{index}.pdf")
    command(cli, "imprint", File.join(__dir__, "source.svg"), "--declaration", path, "--output", pdf)
    pdf
  end

  mappings = pages.each_with_index.to_h { |path, index| [index.to_s, path] }
  sources = mappings.keys.to_h { [it, {"input" => it, "overrides" => {}}] }
  plan = {
    "version" => 1,
    "sources" => sources,
    "parts" => [{"pages" => mappings.keys.map { {"source" => it, "page" => 0} }}]
  }
  File.write(File.join(directory, "inputs.json"), JSON.generate(mappings))
  File.write(File.join(directory, "plan.json"), JSON.generate(plan))
  composed = File.join(directory, "composed.pdf")
  command(
    cli,
    "compose",
    File.join(directory, "plan.json"),
    "--inputs",
    File.join(directory, "inputs.json"),
    "--output",
    composed
  )
  base = File.join(directory, "base.pdf")
  revise(composed, base) do |document, manifest|
    manifest["publication"] = {"id" => "mainz/recipe-checks", "compat" => 1}
    document.metadata.title("Recipe checks")
  end

  revise(base, File.join(directory, "update.pdf")) { |document, _| document.metadata.title("Updated recipe checks") }
  %w[compat format style unnamed].each do |name|
    revise(base, File.join(directory, "#{name}.pdf")) do |_, manifest|
      case name
      when "compat"
        manifest["publication"]["compat"] = 2
      when "format"
        manifest["version"] = 999
      when "style"
        manifest.fetch("profileSets").each { it["family"] = "other" }
      when "unnamed"
        manifest.fetch("pages").each { it.delete("name") }
      end
    end
  end

  {"review" => [0, 2, 1], "page" => [0], "count" => [0, 1]}.each do |name, sequence|
    selection = File.join(directory, "#{name}-pages.json")
    File.write(selection, JSON.generate(sequence))
    command(cli, "extract", base, "--pages", selection, "--output", File.join(directory, "#{name}.pdf"))
  end

  bindings = File.join(directory, "bindings.json")
  File.write(bindings, JSON.generate("book" => base))
  record = {
    "version" => 1,
    "inputs" => {"book" => {}},
    "sources" => {
      "source" => {"input" => "book", "profiles" => [{"family" => "checks", "name" => "Fine", "all" => true}]}
    },
    "parts" => [{"pages" => [{"source" => "source", "pages" => "all"}]}]
  }
  seed = File.join(directory, "seed.json")
  File.write(seed, JSON.generate(record))
  aligned = File.join(directory, "aligned.json")
  command(cli, "align", seed, "--inputs", bindings, "--output", aligned, "--force")
  reference = JSON.parse(File.read(aligned))
  cases = JSON.parse(File.read(File.join(__dir__, "cases.json")))
  cases.each do |entry|
    recipe = Marshal.load(Marshal.dump(reference))
    recipe["parts"][0]["pages"] = [{"source" => "source", "page" => 2}] if entry.fetch("id") == "page"
    recipe["inputs"]["book"]["title"] = "Recipe checks"
    File.write(File.join(directory, "#{entry.fetch("id")}.json"), JSON.pretty_generate(recipe) + "\n")
  end

  File.write(File.join(directory, "cases.json"), JSON.pretty_generate(cases) + "\n")
  # Bindings used by the builder must not retain its disposable staging path.
  FileUtils.rm_f(Dir.glob(File.join(directory, "{page-*,*-pages,inputs,bindings,plan,seed,aligned,composed}.*")))
  FileUtils.rm_rf(output)
  File.rename(directory, output)
  puts(JSON.generate(directory: output, cases: cases.map { it.fetch("id") }))
ensure
  FileUtils.rm_rf(directory) if File.exist?(directory)
end
