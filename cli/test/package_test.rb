# frozen_string_literal: true

require "minitest/autorun"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::Package)

module Mainz
  class PackageTest < Minitest::Test
    def test_install_replaces_stale_members_and_keeps_failed_output
      Dir.mktmpdir("install-", Mainz.workspace("tmp/test/package").to_s) do |directory|
        destination = Pathname(directory).join("package")
        destination.mkpath
        destination.join("obsolete.txt").write("Old package")
        Package.install(destination) { |package| package.join("mainz").binwrite("New package") }
        assert_equal(["mainz"], destination.children.map { |path| path.basename.to_s })
        assert_raises(RuntimeError) do
          Package.install(destination) do |package|
            package.join("partial").write("Incomplete package")
            raise "Copy failed"
          end
        end

        assert_equal(["mainz"], destination.children.map { |path| path.basename.to_s })
        assert_equal("New package", destination.join("mainz").binread)
      end
    end

    def test_archive_preserves_binary_content_names_and_modes
      Dir.mktmpdir("archive-", Mainz.workspace("tmp/test/package").to_s) do |temporary|
        directory = Pathname(temporary).join("mainz-linux-x86_64")
        directory.join("notices").mkpath
        directory.join("mainz").binwrite("\x7fELF\x00\xff".b)
        directory.join("mainz").chmod(0o755)
        directory.join("notices/license with spaces.txt").write("License.\n")
        archive = Pathname(temporary).join("mainz.tar.gz")
        Package.archive(directory, archive)
        entries = {}
        Zlib::GzipReader.open(archive.to_s) do |gzip|
          Gem::Package::TarReader.new(gzip) do |tar|
            tar.each { |entry| entries[entry.full_name] = [entry.header.mode, entry.file? ? entry.read : nil] }
          end
        end

        assert_equal(
          %w[
            mainz-linux-x86_64
            mainz-linux-x86_64/mainz
            mainz-linux-x86_64/notices
            mainz-linux-x86_64/notices/license\ with\ spaces.txt
          ]
            .sort,
          entries.keys.sort
        )
        assert_equal([0o755, "\x7fELF\x00\xff".b], entries["mainz-linux-x86_64/mainz"])
        assert_equal("License.\n", entries["mainz-linux-x86_64/notices/license with spaces.txt"][1])
      end
    end
  end
end
