cmake_minimum_required(VERSION 3.25)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/VERSION" mainz_version)
string(STRIP "${mainz_version}" mainz_version)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/VERSION")
project(mainz VERSION ${mainz_version} LANGUAGES CXX)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
option(MAINZ_LINT "Run C++ formatting and clang-tidy checks" ON)
option(MAINZ_SANITIZE "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
set(MAINZ_QPDF_SOURCE "" CACHE PATH "Local checkout of QPDF 12.4.2")

if(MAINZ_SANITIZE)
  if(EMSCRIPTEN)
    message(FATAL_ERROR "Use the native sanitize preset for ASan/UBSan")
  endif()
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
  add_link_options(-fsanitize=address,undefined)
endif()

if(MAINZ_QPDF_SOURCE)
  find_package(Git REQUIRED)
  execute_process(COMMAND ${GIT_EXECUTABLE} -C ${MAINZ_QPDF_SOURCE} rev-parse HEAD
    OUTPUT_VARIABLE qpdf_revision OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  if(NOT qpdf_revision STREQUAL "4eba95899886e851cc41d76886483b347612f2a8")
    message(FATAL_ERROR "Mainz requires the pinned QPDF 12.4.2 revision")
  endif()
  execute_process(COMMAND ${GIT_EXECUTABLE} -C ${MAINZ_QPDF_SOURCE} status --porcelain
    OUTPUT_VARIABLE qpdf_changes OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  if(qpdf_changes)
    message(FATAL_ERROR "The pinned QPDF checkout must have no local changes")
  endif()
  set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
  set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
  set(BUILD_DOC OFF CACHE BOOL "" FORCE)
  set(USE_IMPLICIT_CRYPTO OFF CACHE BOOL "" FORCE)
  set(REQUIRE_CRYPTO_NATIVE ON CACHE BOOL "" FORCE)
  add_subdirectory(${MAINZ_QPDF_SOURCE} qpdf EXCLUDE_FROM_ALL)
  add_library(qpdf::libqpdf ALIAS libqpdf)
else()
  if(EMSCRIPTEN)
    message(FATAL_ERROR "Set MAINZ_QPDF_SOURCE for the WASM build")
  endif()
  find_package(qpdf 12.4.2 EXACT CONFIG REQUIRED)
endif()

set(processor_sources lib/src/contract.cpp lib/src/content.cpp lib/src/processor.cpp
  lib/src/processor/document.cpp lib/src/processor/style.cpp lib/src/processor/compose.cpp)
add_library(processor ${processor_sources})
target_compile_features(processor PUBLIC cxx_std_20)
target_include_directories(processor PUBLIC lib/src)
target_link_libraries(processor PRIVATE qpdf::libqpdf)

add_library(wasm_boundary OBJECT lib/src/wasm.cpp)
target_compile_features(wasm_boundary PRIVATE cxx_std_20)
target_link_libraries(wasm_boundary PRIVATE qpdf::libqpdf)
set(mainz_sources ${processor_sources} lib/src/wasm.cpp)
set(mainz_targets processor wasm_boundary)
include(CTest)

if(EMSCRIPTEN)
  if(MAINZ_LINT)
    message(FATAL_ERROR "Run clang-tidy with the native preset before building WASM")
  endif()
  get_filename_component(emscripten_directory ${CMAKE_CXX_COMPILER} DIRECTORY)
  file(READ ${emscripten_directory}/emscripten-version.txt emscripten_version)
  string(STRIP "${emscripten_version}" emscripten_version)
  if(NOT emscripten_version STREQUAL "\"6.0.10\"")
    message(FATAL_ERROR "Mainz requires Emscripten 6.0.10")
  endif()
  add_executable(mainz $<TARGET_OBJECTS:wasm_boundary>)
  target_link_libraries(mainz PRIVATE processor)
  set_target_properties(mainz PROPERTIES OUTPUT_NAME processor SUFFIX .mjs)
  target_link_options(mainz PRIVATE
    --no-entry --use-port=zlib --use-port=libjpeg
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=1048576
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sFILESYSTEM=0
    -sEXPORTED_RUNTIME_METHODS=HEAPU8
    "-sEXPORTED_FUNCTIONS=[\"_malloc\",\"_free\",\"_mainz_read\",\"_mainz_describe\",\"_mainz_apply\",\"_mainz_reset\",\"_mainz_extract\",\"_mainz_close\",\"_mainz_result\",\"_mainz_size\",\"_mainz_status\",\"_mainz_input\",\"_mainz_clear_inputs\",\"_mainz_compose\",\"_mainz_report\",\"_mainz_report_size\"]")
else()
  # SVG discovery stays available when QPDF uses explicit dependency archive paths.
  find_program(SVG_PKG_CONFIG_EXECUTABLE pkg-config REQUIRED)
  set(PKG_CONFIG_EXECUTABLE ${SVG_PKG_CONFIG_EXECUTABLE})
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(SVG REQUIRED IMPORTED_TARGET cairo librsvg-2.0 libxml-2.0)
  pkg_check_modules(FONT_CACHE REQUIRED IMPORTED_TARGET pangocairo fontconfig)
  set(producer_sources lib/src/producer.cpp lib/src/producer/svg.cpp lib/src/producer/capture.cpp)
  add_library(producer ${producer_sources})
  target_compile_features(producer PUBLIC cxx_std_20)
  target_link_libraries(producer PUBLIC processor PRIVATE qpdf::libqpdf PkgConfig::SVG)
  set(cli_sources cli/src/main.cpp cli/src/command.cpp cli/src/command/describe.cpp cli/src/command/verify.cpp
    cli/src/command/apply.cpp cli/src/command/reset.cpp cli/src/command/extract.cpp cli/src/command/compose.cpp
    cli/src/command/produce.cpp cli/src/command/version.cpp)
  add_executable(mainz ${cli_sources})
  target_compile_definitions(mainz PRIVATE MAINZ_VERSION="${PROJECT_VERSION}")
  target_include_directories(mainz PRIVATE cli/src)
  target_link_libraries(mainz PRIVATE producer qpdf::libqpdf PkgConfig::FONT_CACHE PkgConfig::SVG)
  list(APPEND mainz_sources ${producer_sources} ${cli_sources})
  list(APPEND mainz_targets producer mainz)
  if(MAINZ_LINT)
    find_program(CLANG_FORMAT_EXECUTABLE clang-format REQUIRED)
    set(format_sources ${mainz_sources} lib/src/processor.hh lib/src/contract.hh lib/src/content.hh lib/src/pipeline.hh
      lib/src/producer.hh lib/src/producer/internal.hh lib/src/processor/engine.hh cli/src/command.hh)
    add_custom_target(format
      COMMAND ${CLANG_FORMAT_EXECUTABLE} -i ${format_sources}
      WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
      COMMENT "Format Mainz C++ sources"
      VERBATIM)
    add_custom_target(format-check ALL
      COMMAND ${CLANG_FORMAT_EXECUTABLE} --dry-run --Werror ${format_sources}
      WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
      COMMENT "Check Mainz C++ formatting"
      VERBATIM)
    foreach(target IN LISTS mainz_targets)
      add_dependencies(${target} format-check)
    endforeach()
  endif()
endif()

if(BUILD_TESTING)
  find_program(BUNDLE_EXECUTABLE bundle REQUIRED)
  if(EMSCRIPTEN)
    set(MAINZ_NATIVE_CLI "${CMAKE_SOURCE_DIR}/.local/var/cpp/build/native/mainz" CACHE FILEPATH "Native CLI for parity tests")
    set(test_names parity)
    set(test_environment "MAINZ_CLI=${MAINZ_NATIVE_CLI};MAINZ_WASM=$<TARGET_FILE:mainz>")
  else()
    set(test_names contract producer cli inspector package)
    set(test_environment "MAINZ_CLI=$<TARGET_FILE:mainz>")
  endif()
  foreach(name IN LISTS test_names)
    add_test(NAME ${name} COMMAND ${BUNDLE_EXECUTABLE} exec rake
      --rakefile ${CMAKE_SOURCE_DIR}/Rakefile test:${name})
    set_tests_properties(${name} PROPERTIES
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
      ENVIRONMENT "${test_environment};BUNDLE_PATH=${CMAKE_SOURCE_DIR}/.local/var/ruby;BUNDLE_APP_CONFIG=${CMAKE_SOURCE_DIR}/.local/var/ruby"
      RUN_SERIAL TRUE)
  endforeach()
endif()

foreach(target IN LISTS mainz_targets)
  target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror)
  if(EMSCRIPTEN)
    target_compile_options(${target} PRIVATE -fexceptions)
  endif()
endforeach()

if(MAINZ_LINT)
  find_program(CLANG_TIDY_EXECUTABLE clang-tidy REQUIRED)
  foreach(target IN LISTS mainz_targets)
    set_target_properties(${target} PROPERTIES CXX_CLANG_TIDY "${CLANG_TIDY_EXECUTABLE}")
  endforeach()
  add_custom_target(lint
    COMMAND ${CLANG_TIDY_EXECUTABLE} -p ${CMAKE_BINARY_DIR} ${mainz_sources}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Run clang-tidy on all Mainz C++ sources"
    VERBATIM)
  add_dependencies(lint format-check)
endif()
