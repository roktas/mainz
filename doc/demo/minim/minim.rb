#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "json"
require "open3"

megic = File.expand_path(ARGV.fetch(0))
cli = File.expand_path(ARGV.fetch(1))
$LOAD_PATH.unshift(File.join(megic, "lib"))
require "megic"

directory = File.expand_path("../../../.local/var/demo/minim", __dir__)
FileUtils.mkdir_p(directory)
bindings = File.join(directory, "inputs.json")
source = File.expand_path("../../../.local/var/demo/dolor/dolor.pdf", __dir__)
source = File.expand_path("../../../web/test/fixtures/dolor.pdf", __dir__) unless File.file?(source)
File.write(bindings, JSON.generate("sample" => source))
path = File.join(directory, "composed.pdf")
FileUtils.rm_f(path)

def command(*arguments)
  out, err, status = Open3.capture3(*arguments)
  raise "#{arguments.first}: #{err}" unless status.success?
  out
end

command(cli, "compose", File.join(__dir__, "minim.json"), "--inputs", bindings, "--output", path)
Sevgi::Sundries::Export.metadata!(path, description: "Prepared practice pages for italic letterforms, steady pen movement, rhythm, spacing, and repeated writing exercises")
Megic::Pdf.normalize(path, shell: Sevgi::F)
command("qpdf", "--check", path)
command(cli, "verify", path)
description = JSON.parse(command(cli, "describe", path))
raise "Unexpected page count" unless description.fetch("pageCount") == 3
FileUtils.cp(path, File.join(directory, "minim.pdf"))
