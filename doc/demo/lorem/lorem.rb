# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"

module ReadingDemo
  module_function

  def run(*arguments, **options)
    out, err, status = Open3.capture3(*arguments, **options)
    raise "#{arguments.join(" ")}:\n#{out}#{err}" unless status.success?

    out
  end

  def omit_dates(pdf, directory)
    _, objects = JSON.parse(run("qpdf", "--json", "--json-key=qpdf", "--json-object=trailer", pdf)).fetch("qpdf")
    reference = objects.fetch("trailer").fetch("value")["/Info"]
    return unless reference

    selector = reference.split.take(2).join(",")
    update = JSON.parse(run("qpdf", "--json", "--json-key=qpdf", "--json-object=#{selector}", pdf))
    info = update.fetch("qpdf").last.fetch("obj:#{reference}").fetch("value")
    # ConTeXt's --nodates can write false instead of omitting the optional Info dates.
    info.delete("/CreationDate")
    info.delete("/ModDate")
    path = File.join(directory, "info.json")
    File.write(path, JSON.generate(update))
    "--update-from-json=#{path}"
  end

  def build(name, cli)
    root = File.expand_path("../../..", __dir__)
    source = File.join(root, "doc/demo", name)
    directory = File.join(root, ".local/tmp/demo", name)
    FileUtils.mkdir_p(directory)
    run(
      "context",
      "--batchmode",
      "--nonstopmode",
      "--nodates",
      "--trailerid=no",
      "--result=#{name}",
      "--path=#{source}",
      File.join(source, "#{name}.tex"),
      chdir: directory
    )
    raw = File.join(directory, "#{name}.pdf")
    count = Integer(run("qpdf", "--show-npages", raw))
    output = File.join(directory, "prepared.pdf")
    arguments = ["qpdf", raw, "--deterministic-id", omit_dates(raw, directory)].compact
    if name == "lorem"
      manifest = {
        version: 1,
        pages: [{name: "Cover"}, *Array.new(count - 1) { {} }],
        regions: {},
        baselines: {},
        targets: {},
        parameters: {}
      }
      attachment = File.join(directory, "mainz.json")
      File.write(attachment, JSON.generate(manifest))
      arguments.push(
        "--add-attachment",
        attachment,
        "--filename=mainz.json",
        "--mimetype=application/json",
        "--creationdate=D:19700101000000Z",
        "--moddate=D:19700101000000Z",
        "--"
      )
    end

    run(*arguments, output)

    run("qpdf", "--check", output)
    run(cli, "verify", output) if name == "lorem"
    outlines = JSON.parse(run("qpdf", "--json", "--json-key=outlines", output)).fetch("outlines")
    if name == "lorem"
      raise "Expected four chapters" unless outlines.size == 4
      raise "Expected three sections per chapter" unless outlines.all? { it.fetch("kids").size == 3 }
      unless outlines.flat_map { it.fetch("kids") }.all? { it.fetch("kids").size == 2 }
        raise "Expected two subsections per section"
      end

      raise "Expected 42 pages" unless count == 42
    else
      raise "Expected three chapters" unless outlines.size == 3 && outlines.all? { it.fetch("kids").empty? }
      raise "Expected a shorter reading sample" unless count.between?(8, 24)
    end

    raise "PDF exceeds the 2 MiB demo budget" if File.size(output) > 2 * 1024 * 1024

    published = File.join(root, ".local/var/demo", name, "#{name}.pdf")
    FileUtils.mkdir_p(File.dirname(published))
    File.rename(output, published)
    puts(JSON.generate(output: published, pages: count))
  end
end
