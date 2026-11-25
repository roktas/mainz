# frozen_string_literal: true

require_relative "contract_helper"

module Mainz
  class ContractProfileTest < Minitest::Test
    include ContractHelper

    def test_publication_claims_do_not_follow_changed_page_sequences
      publication = {"id" => "fixture/book", "compat" => 1}
      source = file("publication.pdf")
      fixture(source, -> (manifest) { manifest["publication"] = publication })
      assert_equal(publication, describe(source)["publication"])
      unchanged = extract(source, "publication-unchanged.pdf", [0, 1])
      assert_equal(source.binread, unchanged.binread)
      assert_equal(publication, describe(unchanged)["publication"])
      reversed = extract(source, "publication-reversed.pdf", [1, 0])
      refute(describe(reversed).key?("publication"))
      pruned = extract(source, "publication-pruned.pdf", [0])
      refute(describe(pruned).key?("publication"))
      [0, -1, 1.5, "1"].each do |compat|
        fixture(source, -> (manifest) { manifest["publication"] = publication.merge("compat" => compat) })
        assert_equal("invalid-contract", failure_code(source))
      end
    end

    def test_profiles_survive_styling_extraction_and_composition
      source, manifest = profiles_fixture
      description = command(@cli, "describe", source).stdout
      assert_equal(manifest["profileSets"], JSON.parse(description)["profileSets"])
      changed = operation(source, "profiles-edited.pdf", manifest["profileSets"][0]["profiles"][1]["overrides"])
      assert_equal(manifest["profileSets"], snapshot(changed)[0]["profileSets"])
      restored = operation(changed, "profiles-reset.pdf", reset: true)
      assert_equal(manifest["profileSets"], snapshot(restored)[0]["profileSets"])
      pruned = extract(source, "profiles-extracted.pdf", [0])
      [source, changed, restored, pruned].each do |candidate|
        summary = describe(candidate)
        assert_equal(manifest["parameters"]["width"]["schema"], summary["parameters"]["width"]["parameter"]["schema"])
        assert_equal(
          {"family" => "fixture", "key" => "width"},
          summary["parameters"]["width"]["parameter"].slice("family", "key")
        )
        assert_equal(manifest["groups"][0].except("parameters"), summary["groups"][0].except("parameters"))
      end

      profile = snapshot(pruned)[0]["profileSets"][0]
      assert_equal(["width"], profile["parameters"])
      assert_equal({"width" => 0.15}, profile["profiles"][1]["overrides"])
      write("inputs.json", {"input" => source.to_s})
      request = {
        "version" => 1,
        "sources" => %w[a b].to_h { |id| [id, {"input" => "input", "overrides" => {}}] },
        "parts" => [
          {
            "pages" => [
              {"source" => "a", "page" => 0},
              {"source" => "a", "page" => 1},
              {"source" => "a", "page" => 0},
              {"source" => "b", "page" => 1}
            ]
          }
        ]
      }
      output, result = compose(request, "profiles-composed.pdf")
      sets = snapshot(output)[0]["profileSets"]
      assert_equal(2, sets.length)
      assert_equal(2, sets.map { |item| item["id"] }.uniq.length)
      assert_empty(sets[0]["parameters"] & sets[1]["parameters"])
      mapping = JSON.parse(result.stdout)["parameters"]
      summary = describe(output)
      mapping.each do |id, original|
        next unless original["parameter"] == "width"

        assert_equal(manifest["parameters"]["width"]["schema"], summary["parameters"][id]["parameter"]["schema"])
        assert_equal(
          {"family" => "fixture", "key" => "width"},
          summary["parameters"][id]["parameter"].slice("family", "key")
        )
      end

      assert_equal(
        [%w[guide-color guide-fill width]] * 2,
        sets.map { |item| item["parameters"].map { |id| mapping[id]["parameter"] }.sort }
      )
      [profile, *sets].each do |set|
        assert_equal(
          manifest["profileSets"][0].except("id", "parameters", "profiles"),
          set.except("id", "parameters", "profiles")
        )
        assert_equal(
          manifest["profileSets"][0]["profiles"].map { |choice| choice.except("overrides") },
          set["profiles"].map { |choice| choice.except("overrides") }
        )
      end

      foreign = file("foreign-family.pdf")
      fixture(
        foreign,
        -> (data) {
          profile_fixture(data)
          data["parameters"].each_value { |parameter| parameter["family"] = "foreign" }
          data["profileSets"][0]["family"] = "foreign"
        },
        pdf_objects: method(:across_page_objects)
      )
      write("inputs.json", {"input" => source.to_s, "foreign" => foreign.to_s})
      request["sources"]["b"] = {"input" => "foreign", "overrides" => {"width" => 0.25}}
      mixed, provenance = compose(request, "mixed-families.pdf")
      description = describe(mixed)
      assert_equal(%w[fixture foreign], description["profileSets"].map { |set| set["family"] })
      JSON.parse(provenance.stdout)["parameters"].each do |id, original|
        next unless original == {"source" => "b", "parameter" => "width"}

        assert_equal("foreign", description["parameters"][id]["parameter"]["family"])
        assert_equal("width", description["parameters"][id]["parameter"]["key"])
        assert_equal(0.25, description["parameters"][id]["parameter"]["value"])
      end
    end

    def test_profiles_require_valid_scopes_and_original_first_choice
      mutations = [
        -> (s) { s[0]["extra"] = true },
        -> (s) { s[0]["parameters"] = ["unknown"] },
        -> (s) { s << JSON.parse(JSON.generate(s[0])) },
        -> (s) { s[0]["profiles"][0]["overrides"] = {"width" => 0.1} },
        -> (s) { s[0]["profiles"][1]["overrides"] = {"guide-fill" => 1.1} },
        -> (s) { s[0]["profiles"][1]["overrides"] = {"opacity" => 0.1} },
        -> (s) { s[0]["profiles"][1]["id"] = "generic" },
        -> (s) { s[0]["profiles"][1]["name"] = "" },
        -> (s) { s[0]["profiles"][1]["description"] = false },
        -> (s) { s[0]["family"] = " " },
        -> (s) { s[0]["family"] = 1 },
        -> (s) { s[0]["profiles"][1]["name"] = s[0]["profiles"][0]["name"] },
        -> (s) { s[0]["profiles"] *= 17 }
      ]
      mutations.each do |mutation|
        fixture(
          file("invalid-profiles.pdf"),
          -> (manifest) {
            profile_fixture(manifest)
            mutation.call(manifest["profileSets"])
          },
          pdf_objects: method(:across_page_objects)
        )
        assert_equal("invalid-contract", failure_code(file("invalid-profiles.pdf")))
      end
    end

    def test_semantic_keys_require_complete_consistent_metadata
      mutations = [
        -> (p) { p["width"].delete("family") },
        -> (p) { p["width"].delete("key") },
        -> (p) { p["width"]["family"] = "\u00a0" },
        -> (p) { p["width"]["key"] = " " },
        -> (p) { p["width"]["key"] = 1 },
        -> (p) { p["width"]["family"] = "bad\nfamily" },
        -> (p) { p["guide-color"]["key"] = "width" }
      ]
      mutations.each do |mutation|
        fixture(
          file("invalid-semantics.pdf"),
          -> (manifest) {
            profile_fixture(manifest)
            mutation.call(manifest["parameters"])
          },
          pdf_objects: method(:across_page_objects)
        )
        assert_equal("invalid-contract", failure_code(file("invalid-semantics.pdf")))
      end
    end

    def test_profile_details_obey_json_string_limits
      source = file("profile-details.pdf")
      [2048, 2049].each do |length|
        manifest = fixture(
          source,
          -> (data) {
            profile_fixture(data)
            data["profileSets"][0]["profiles"][0]["details"] = "ğ" * length
          },
          pdf_objects: method(:across_page_objects)
        )
        if length == 2048
          assert_equal(manifest["profileSets"], describe(source)["profileSets"])
        else
          assert_equal("limit-exceeded", failure_code(source))
        end
      end
    end

    def test_details_require_descriptions_on_every_annotation_owner
      owners = [
        -> (data) { data["parameters"]["width"]["schema"] },
        -> (data) { data["groups"][0] },
        -> (data) { data["profileSets"][0] },
        -> (data) { data["profileSets"][0]["profiles"][1] }
      ]
      owners.each do |owner|
        [nil, false, 1, [], {}].each do |invalid|
          fixture(
            file("invalid-annotations.pdf"),
            -> (data) {
              profile_fixture(data)
              owner.call(data)["details"] = invalid
            },
            pdf_objects: method(:across_page_objects)
          )
          assert_equal("invalid-contract", failure_code(file("invalid-annotations.pdf")))
        end

        [:missing, "", " \t\n", "\u00a0\u2003\u202f\ufeff"].each do |description|
          fixture(
            file("invalid-annotations.pdf"),
            -> (data) {
              profile_fixture(data)
              annotation = owner.call(data)
              annotation["details"] = "Longer guidance."
              if description == :missing
                annotation.delete("description")
              else
                annotation["description"] = description
              end
            },
            pdf_objects: method(:across_page_objects)
          )
          assert_equal("invalid-contract", failure_code(file("invalid-annotations.pdf")))
        end
      end
    end
  end
end
