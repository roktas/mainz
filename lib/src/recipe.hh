#ifndef MAINZ_RECIPE_HH
#define MAINZ_RECIPE_HH

#include "processor.hh"

namespace mainz {
struct Resolution {
    std::string plan;
    std::string checks;
    std::string intent;
    std::string aligned;
};
std::string recipe_inputs(const std::string& recipe);
std::string recipe_reference(const Document& input);
std::string check_recipe_input(const std::string& recipe, const std::string& id, const Document& input);
Resolution resolve_recipe(
    const std::string& recipe, const std::map<std::string, std::string>& inputs, bool force = false);
Resolution resolve_recipe(const std::string& recipe, const std::map<std::string, Document>& inputs, bool force = false);
}
#endif
