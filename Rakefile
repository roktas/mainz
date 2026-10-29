# frozen_string_literal: true

require "base64"
require "digest"
require "fileutils"
require "find"
require "hexapdf"
require "json"
require "open3"
require "pathname"
require "rake"
require "rake/testtask"
require "rubygems/package"
require "tmpdir"
require "zlib"

module Mainz
  QPDF_REVISION = "4eba95899886e851cc41d76886483b347612f2a8"
  ROOT = Pathname(__dir__).expand_path
  VERSION = ROOT.join("VERSION").read.strip
  Result = Data.define(:stdout, :stderr, :status)

  module_function

  def capture(*arguments, input: nil, chdir: ROOT)
    stdout, stderr, status = Open3.capture3(*arguments.map(&:to_s), stdin_data: input, chdir: chdir.to_s, binmode: true)
    Result.new(stdout, stderr, status)
  end

  def run(*arguments, **options)
    result = capture(*arguments, **options)
    unless result.status.success?
      raise "#{arguments.join(" ")} failed (#{result.status.exitstatus}):\n#{result.stdout}#{result.stderr}"
    end

    result.stdout
  end

  def workspace(*parts)
    path = ROOT.join(".local", *parts)
    path.mkpath
    path
  end

  # Retains lexical operands while using HexaPDF's inline-image parser.
  class LexicalParser < HexaPDF::Content::Parser
    def parse(contents)
      tokenizer = HexaPDF::Content::Tokenizer.new(contents)
      operands = []
      start = 0
      loop do
        object = tokenizer.next_object(allow_keyword: true)
        break if object == HexaPDF::Tokenizer::NO_MORE_TOKENS

        if object.is_a?(HexaPDF::Tokenizer::Token)
          operands = parse_inline_image(tokenizer) if object == "BI"
          yield object.to_sym, operands, contents.byteslice(start...tokenizer.pos).strip
          operands = []
          start = tokenizer.pos
        else
          operands << object
        end
      end

      raise HexaPDF::MalformedPDFError, "Trailing PDF operands" unless operands.empty?
    end
  end

  private_constant :LexicalParser

  class Preservation
    BOXES = %i[MediaBox CropBox BleedBox TrimBox ArtBox].freeze
    PATHS = %i[m l c v y h re].freeze
    PAINTS = %i[S s f f* B B* b b*].freeze
    TEXT = %i[BT ET Tf Tj TJ Td TD Tm T* ' " Tc Tw Tz TL Tr Ts].freeze
    private_constant :BOXES, :PATHS, :PAINTS, :TEXT

    def self.read(path) = new(path).pages

    def initialize(path)
      @document = HexaPDF::Document.open(path.to_s, config: {"parser.on_correctable_error" => -> (*) { true }})
    end

    def pages
      @document.pages.map do |page|
        snapshot = {geometry: [], clips: [], transforms: [], texts: [], images: [], fonts: [], contexts: []}
        walk(page.contents, page[:Resources], snapshot, 0)
        snapshot.merge(
          boxes: BOXES.map { |key| value(page[key]) },
          rotation: page[:Rotate] || 0,
          unit: page[:UserUnit] || 1,
          fonts: snapshot[:fonts].sort
        )
      end
    end

    private

    def dictionary(object)
      @document.wrap(@document.deref(object), type: HexaPDF::Dictionary)
    end

    def value(object)
      object = @document.deref(object)
      object = object.value if object.is_a?(HexaPDF::Object)
      object.is_a?(Array) ? object.map { |item| value(item) } : object
    end

    def walk(contents, resources, snapshot, depth, matrix = [], clips = [])
      raise "Unexpected Form depth" if depth > 16

      resources = dictionary(resources || {})
      geometry = []
      stack = []
      pending = nil
      LexicalParser.new.parse(contents) do |operator, operands, raw|
        if PATHS.include?(operator)
          geometry << raw
          snapshot[:contexts] << [operator, matrix, clips]
        elsif PAINTS.include?(operator)
          snapshot[:geometry] << geometry.join(" ")
          snapshot[:contexts] << [:paint, matrix, clips]
          geometry = []
          clips += [pending] if pending
          pending = nil
        elsif %i[W W*].include?(operator)
          snapshot[:clips] << [geometry.join(" "), operator]
          snapshot[:contexts] << [operator, matrix, clips]
          pending = [geometry.join(" "), operator, matrix]
        elsif operator == :n
          geometry = []
          clips += [pending] if pending
          pending = nil
        elsif operator == :q
          raise "Graphics state exceeds depth 64" if stack.length >= 64

          stack << [matrix, clips]
        elsif operator == :Q
          raise "Graphics-state underflow" if stack.empty?

          matrix, clips = stack.pop
        elsif operator == :cm
          snapshot[:transforms] << raw
          matrix += [raw]
        elsif TEXT.include?(operator)
          snapshot[:texts] << raw
          snapshot[:contexts] << [operator, matrix, clips]
        elsif operator == :BI
          snapshot[:images] << raw
          snapshot[:contexts] << [:image, matrix, clips]
        elsif operator == :Do
          target = dictionary(resources[:XObject])[operands.first]
          if target[:Subtype] == :Form
            local = value(target.value[:Matrix])
            snapshot[:transforms] << [local, value(target[:BBox])]
            snapshot[:contexts] << [:form, matrix, clips]
            walk(
              target.stream,
              target[:Resources] || resources,
              snapshot,
              depth + 1,
              local ? matrix + [local] : matrix,
              clips
            )
          else
            snapshot[:images] << Digest::SHA256.digest(target.stream)
            snapshot[:contexts] << [:image, matrix, clips]
          end
        end
      end

      raise "Unclosed graphics state" unless stack.empty?
      raise "Unterminated clipping path" if pending

      (resources && resources[:Font] || {}).each do |_name, font|
        font = dictionary(font)
        (font[:DescendantFonts] || [font]).each do |descendant|
          descriptor = dictionary(descendant)[:FontDescriptor]
          next unless descriptor

          descriptor = dictionary(descriptor)
          %i[FontFile FontFile2 FontFile3].each do |key|
            snapshot[:fonts] << [key.to_s, Digest::SHA256.digest(descriptor[key].stream)] if descriptor[key]
          end
        end
      end
    end
  end

  module Package
    module_function

    def install(destination)
      destination = Pathname(destination)
      Dir.mktmpdir("#{destination.basename}-", Mainz.workspace("tmp/package").to_s) do |directory|
        package = Pathname(directory).join(destination.basename)
        package.mkpath
        yield package
        destination.parent.mkpath
        FileUtils.rm_rf(destination)
        File.rename(package, destination)
      end

      destination
    end

    def archive(directory, destination)
      Zlib::GzipWriter.open(destination.to_s) do |gzip|
        Gem::Package::TarWriter.new(gzip) do |tar|
          Find.find(directory.to_s) do |path|
            name = Pathname(path).relative_path_from(directory.parent).to_s
            stat = File.lstat(path)
            mode = stat.mode & 0o7777
            if stat.directory?
              tar.mkdir(name, mode)
            elsif stat.file?
              tar.add_file_simple(name, mode, stat.size) do |entry|
                File.open(path, "rb") { |file| IO.copy_stream(file, entry) }
              end
            else
              raise "Unsupported package member: #{path}"
            end
          end
        end
      end

      destination
    end

    def native(zlib_prefix:, jpeg_prefix:)
      raise "This development bundle supports Linux x86_64 only." unless RUBY_PLATFORM.match?(/x86_64-linux/)

      source = Pathname(ENV.fetch("MAINZ_QPDF_SOURCE", ROOT.join(".local/src/qpdf").to_s)).expand_path
      prefixes = {zlib: Pathname(zlib_prefix).expand_path, jpeg: Pathname(jpeg_prefix).expand_path}
      archives = [prefixes[:zlib].join("lib/libz.a"), prefixes[:jpeg].join("lib/libjpeg.a")]
      hashes = [
        ENV.fetch("ZLIB_SHA256", "0e49a704422319a6800220a83d00db782c350c80c8fe4e5d7a17b835b47ebc6e"),
        ENV.fetch("JPEG_SHA256", "bab5e1b5994716439b07deeafdd5084837cc566f4a7a0a28c129d1d50a307734")
      ]
      archives.zip(hashes).each do |path, expected|
        raise "Missing static archive: #{path}" unless path.file?
        unless Digest::SHA256.file(path).hexdigest == expected
          raise "Static archive differs from the declared build input: #{path}"
        end
      end

      build = Mainz.workspace("var/cpp/build/package")
      output = ROOT.join(".local/var/package/mainz-linux-x86_64")
      Mainz.run(
        "cmake",
        "--fresh",
        "-S",
        ROOT,
        "-B",
        build,
        "-DCMAKE_BUILD_TYPE=Release",
        "-DCMAKE_CXX_COMPILER=clang++",
        "-DBUILD_TESTING=ON",
        "-DMAINZ_QPDF_SOURCE=#{source}",
        "-DPKG_CONFIG_EXECUTABLE=/usr/bin/false",
        "-DZLIB_H_PATH=#{prefixes[:zlib]}/include",
        "-DZLIB_LIB_PATH=#{archives[0]}",
        "-DLIBJPEG_H_PATH=#{prefixes[:jpeg]}/include",
        "-DLIBJPEG_LIB_PATH=#{archives[1]}",
        "-DCMAKE_EXE_LINKER_FLAGS=-static-libstdc++ -static-libgcc"
      )
      puts(Mainz.run("cmake", "--build", build, "--target", "mainz", "-j", "4"))
      puts(
        Mainz.run(
          "ctest",
          "--test-dir",
          build,
          "--output-on-failure",
          "-R",
          "^(contract|producer|cli|inspector|package)$"
        )
      )
      dependencies = Mainz.run("ldd", build.join("mainz"))
      direct = Mainz.run("readelf", "-d", build.join("mainz"))
      %w[libqpdf libz. libjpeg libstdc++ libgcc_s].each do |name|
        raise "Unexpected dynamic dependency: #{name}" if direct.include?(name)
      end

      install(output) do |destination|
        FileUtils.cp(build.join("mainz"), destination.join("mainz"), preserve: true)
        notices = destination.join("notices")
        notices.mkpath
        FileUtils.cp(ROOT.join("LICENSE"), notices.join("mainz.txt"))
        %w[LICENSE.txt NOTICE.md].each { |name| FileUtils.cp(source.join(name), notices.join("qpdf-#{name}")) }
        %w[LICENSE.md README.ijg].each do |name|
          FileUtils.cp(prefixes[:jpeg].join("share/doc/libjpeg-turbo", name), notices.join("jpeg-#{name}"))
        end

        license = [prefixes[:zlib].join("LICENSE.md"), prefixes[:zlib].join("share/doc/zlib-ng/LICENSE.md")].find(
          &:file?
        )
        raise "The zlib prefix must include its license notice." unless license

        FileUtils.cp(license, notices.join("zlib-LICENSE"))
        sources = [
          ROOT.join("LICENSE"),
          ROOT.join("VERSION"),
          ROOT.join("CMakeLists.txt"),
          ROOT.join("CMakePresets.json"),
          ROOT.join("Rakefile"),
          ROOT.join("Gemfile.lock"),
          *ROOT.glob("{lib,cli}/src/**/*.{cpp,hh}").sort
        ]
        headers = %w[zlib.h zconf.h].map { |name| prefixes[:zlib].join("include", name) } +
          %w[jpeglib.h jconfig.h jmorecfg.h].map { |name| prefixes[:jpeg].join("include", name) }
        provenance = {
          version: VERSION,
          license: "GPL-3.0-only",
          status: "development; broader platform evidence remains open",
          qpdfRevision: Mainz.run("git", "-C", source, "rev-parse", "HEAD").strip,
          compiler: Mainz.run("clang++", "--version").lines.first.strip,
          platform: Mainz.run("uname", "-srm").strip,
          dependencies: dependencies,
          directDependencies: direct,
          svgRuntimeVersions: %w[cairo librsvg-2.0 libxml-2.0].to_h { |name|
            [name, Mainz.run("pkg-config", "--modversion", name).strip]
          },
          prefixes: prefixes.transform_values(&:to_s),
          sourceSha256: sources.to_h { |path|
            [path.relative_path_from(ROOT).to_s, Digest::SHA256.file(path).hexdigest]
          },
          sha256: [*archives, *headers, destination.join("mainz")].to_h { |path|
            [path.basename.to_s, Digest::SHA256.file(path).hexdigest]
          }
        }
        destination.join("provenance.json").write(JSON.pretty_generate(provenance) + "\n")
        destination.join("README.md").write(
          <<~MARKDOWN
            # Mainz #{VERSION}

            See the [CLI documentation](https://github.com/roktas/mainz/blob/v#{VERSION}/cli/README.md) for usage.

            Copyright (C) 2026 Recai Oktaş. Mainz is licensed under GPL-3.0-only. See [LICENSE](notices/mainz.txt).
          MARKDOWN
        )
      end

      archive(output, Pathname("#{output}.tar.gz"))
    end

    def wasm
      parent = Mainz.workspace("var/package")
      sdk = Pathname(ENV.fetch("EMSDK")).join("upstream/emscripten")
      licenses = {
        "mainz.txt" => ROOT.join("LICENSE"),
        "emscripten.txt" => sdk.join("LICENSE"),
        "jpeg.txt" => sdk.join("cache/ports/libjpeg/jpeg-9f/README"),
        "qpdf-notice.txt" => ROOT.join(".local/src/qpdf/NOTICE.md"),
        "qpdf.txt" => ROOT.join(".local/src/qpdf/LICENSE.txt"),
        "zlib.txt" => sdk.join("cache/ports/zlib/zlib-1.3.2/LICENSE")
      }
      install(parent.join("wasm")) do |package|
        digests = %w[processor.mjs processor.wasm].to_h do |name|
          FileUtils.cp(ROOT.join(".local/var/cpp/build/wasm", name), package.join(name))
          [name, Digest::SHA256.file(package.join(name)).hexdigest]
        end

        notices = package.join("notices")
        notices.mkpath
        licenses.each { |name, source| FileUtils.cp(source, notices.join(name)) }
        provenance = {
          version: VERSION,
          license: "GPL-3.0-only",
          status: "development; platform evidence remains open",
          revision: ENV.fetch("MAINZ_REVISION", "uncommitted"),
          standard: "C++20",
          qpdf: "12.4.2",
          qpdfRevision: QPDF_REVISION,
          emscripten: "6.0.10",
          zlib: "1.3.2",
          jpeg: "9f",
          files: digests
        }
        package.join("provenance.json").write(JSON.pretty_generate(provenance) + "\n")
      end
    end
  end
end

ENV["MAINZ_CLI"] ||= Mainz::ROOT.join(".local/var/cpp/build/native/mainz").to_s

namespace(:setup) do
  desc("Install web dependencies under .local/var/js")
  task(:web) do
    directory = Mainz.workspace("var/js")
    web = Mainz::ROOT.join("web")
    FileUtils.cp(web.glob("package*.json"), directory)
    puts(Mainz.run("npm", "--prefix", directory, "ci"))
    modules = web.join("node_modules")
    FileUtils.rm_rf(modules)
    FileUtils.ln_s(directory.join("node_modules").relative_path_from(web), modules)
  end
end

namespace(:build) do
  %w[native sanitize wasm].each do |preset|
    desc("Build the #{preset} processor")
    task(preset) do
      source = ENV["MAINZ_QPDF_SOURCE"] || (preset == "sanitize" ? Mainz::ROOT.join(".local/src/qpdf").to_s : nil)
      options = source ? ["-DMAINZ_QPDF_SOURCE=#{source}"] : []
      puts(Mainz.run("cmake", "--preset", preset, *options))
      puts(Mainz.run("cmake", "--build", "--preset", preset))
    end
  end
end

namespace(:test) do
  {
    contract: "lib/test/contract_test.rb",
    producer: "lib/test/producer_test.rb",
    cli: "cli/test/cli_test.rb",
    inspector: "lib/test/preserve_test.rb",
    parity: "lib/test/parity_test.rb",
    package: "cli/test/package_test.rb",
    web: "web/test/setup_test.rb"
  }.each do |name, path|
    Rake::TestTask.new(name) do |test|
      test.test_files = [Mainz::ROOT.join(path).to_s]
      test.warning = true
    end
  end

  task(parity: :contract)
  %w[native sanitize wasm].each do |preset|
    desc("Run the #{preset} CTest suite")
    task(preset) do
      puts(Mainz.run("ctest", "--preset", preset))
    end
  end
end

namespace(:package) do
  desc("Package the Linux development CLI (ZLIB_PREFIX and JPEG_PREFIX required)")
  task(:native) do
    puts(Mainz::Package.native(zlib_prefix: ENV.fetch("ZLIB_PREFIX"), jpeg_prefix: ENV.fetch("JPEG_PREFIX")))
  end

  desc("Package the built WASM consumer files")
  task(:wasm) do
    puts(Mainz::Package.wasm)
  end
end

desc("Compare protected PDF content with HexaPDF")
task(:preserve, %i[original candidate]) do |_task, arguments|
  paths = [arguments[:candidate], *arguments.extras].compact
  raise "Usage: rake preserve[original.pdf,candidate.pdf,...]" unless arguments[:original] && !paths.empty?

  original = Mainz::Preservation.read(arguments[:original])
  paths.each do |path|
    raise "Protected PDF content changed in #{path}" unless Mainz::Preservation.read(path) == original
  end

  puts(JSON.generate(independent: "hexapdf", pages: original.length, protected: true))
end

desc("Build the native processor")
task(build: "build:native")
desc("Run native processor and package tests")
task(test: "test:native")
task(default: :test)
