#ifndef MAINZ_RECIPE_HH
#define MAINZ_RECIPE_HH

#include "processor.hh"

namespace mainz {
struct Resolution {
    std::string plan;
    std::string warnings;
};
std::string recipe_inputs(const std::string& recipe);
Resolution resolve_recipe(const std::string& recipe, const std::map<std::string, std::string>& inputs);
Resolution resolve_recipe(const std::string& recipe, const std::map<std::string, Document>& inputs);
}
#endif
