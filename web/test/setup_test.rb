# frozen_string_literal: true

require "minitest/autorun"
require "rbconfig"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::ROOT)

module Mainz
  class WebSetupTest < Minitest::Test
    def test_setup_restores_resolvable_packages
      Dir.mktmpdir("setup-", Mainz.workspace("tmp/test/web").to_s) do |temporary|
        root = Pathname(temporary).join("project with spaces")
        web = root.join("web")
        web.mkpath
        FileUtils.cp(%w[Rakefile VERSION].map { |name| ROOT.join(name) }, root)
        fixture = root.join("fixture")
        fixture.mkpath
        fixture.join("package.json").write(JSON.generate(name: "fixture", version: "1.0.0"))
        install = root.join(".local/var/js")
        install.mkpath
        install.join("package.json").write(JSON.generate(private: true))
        # npm records local dependencies relative to the directory that will install them.
        Mainz.run("npm", "install", "--offline", "--package-lock-only", fixture, chdir: install)
        FileUtils.mv(install.glob("package*.json"), web)
        modules = web.join("node_modules")
        modules.mkpath
        installed = install.join("node_modules")
        lock = web.join("package-lock.json").binread
        environment = {"npm_config_offline" => "true", "npm_config_cache" => root.join("cache").to_s}

        3.times do |index|
          installed.join("obsolete.txt").write("Stale dependency output") if index == 1
          FileUtils.rm_rf(install) if index == 2
          stdout, stderr, status = Open3.capture3(
            environment,
            RbConfig.ruby,
            "-S",
            "rake",
            "setup:web",
            chdir: root.to_s
          )
          assert(status.success?, "#{stdout}#{stderr}")
          assert_predicate(modules, :symlink?)
          assert_equal(installed.realpath, modules.realpath)
          assert_equal(lock, web.join("package-lock.json").binread)
          refute_path_exists(installed.join("obsolete.txt"))
          assert_equal(
            "1.0.0",
            Mainz
              .run(
                "node",
                "--input-type=module",
                "-e",
                "import pkg from 'fixture/package.json' with { type: 'json' }; console.log(pkg.version)",
                chdir: web
              )
              .strip
          )
        end
      end
    end
  end
end
