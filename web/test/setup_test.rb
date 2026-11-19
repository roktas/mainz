# frozen_string_literal: true

require "minitest/autorun"
require "rbconfig"

load(File.expand_path("../../Rakefile", __dir__)) unless defined?(Mainz::ROOT)

module Mainz
  class WebSetupTest < Minitest::Test
    def test_setup_restores_resolvable_packages
      Dir.mktmpdir("web with spaces-", Mainz.workspace("tmp/test/web").to_s) do |temporary|
        root = Pathname(temporary)
        web = root.join("web")
        web.mkpath
        FileUtils.cp(%w[Rakefile VERSION].map { |name| ROOT.join(name) }, root)
        FileUtils.cp(ROOT.glob("web/package*.json"), web)
        modules = web.join("node_modules")
        modules.mkpath
        installed = root.join(".local/var/js/node_modules")
        lock = web.join("package-lock.json").binread
        version = JSON.parse(web.join("package.json").read).fetch("devDependencies").fetch("vite")
        environment = {"npm_config_offline" => "true", "npm_config_audit" => "false", "npm_config_fund" => "false"}

        3.times do |index|
          installed.join("obsolete.txt").write("Stale dependency output") if index == 1
          FileUtils.rm_rf(root.join(".local/var/js")) if index == 2
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
            version,
            Mainz
              .run(
                "node",
                "--input-type=module",
                "-e",
                "import { version } from 'vite'; console.log(version)",
                chdir: web
              )
              .strip
          )
        end
      end
    end
  end
end
