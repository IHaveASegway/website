/*

WebAssembly entry points for VROOM (matrix-only, single-threaded).

Not part of upstream VROOM. It does what src/main.cpp does for one
JSON input given on the command line, minus file I/O and the routing
options: parse the input, solve with nb_threads = 1, return the JSON
that the CLI prints on stdout. Errors come back as the same
{"code": N, "error": "..."} object the CLI prints.

Licensed BSD-2-Clause, like VROOM.

*/

#include <algorithm>
#include <chrono>
#include <exception>
#include <string>

#include <emscripten/emscripten.h>

#include "../include/rapidjson/include/rapidjson/stringbuffer.h"
#include "../include/rapidjson/include/rapidjson/writer.h"

#include "structures/cl_args.h"
#include "structures/typedefs.h"
#include "structures/vroom/input/input.h"
#include "structures/vroom/solution/solution.h"
#include "utils/exception.h"
#include "utils/input_parser.h"
#include "utils/output_json.h"
#include "utils/version.h"

namespace {

// Holds the last result; the pointer handed to JS stays valid until
// the next call. The module is single-threaded, so one buffer is safe.
std::string last_result;

const char* store(const rapidjson::Document& json) {
  // Same writer as io::write_to_output, so the bytes match the CLI.
  rapidjson::StringBuffer buffer;
  rapidjson::Writer<rapidjson::StringBuffer> writer(buffer);
  json.Accept(writer);
  last_result.assign(buffer.GetString(), buffer.GetSize());
  return last_result.c_str();
}

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE const char* vroom_version() {
  static const std::string version = vroom::get_version();
  return version.c_str();
}

// input: NUL-terminated UTF-8 JSON in VROOM's input format
// (docs/API.md). Every location must be given as an index into a
// custom "matrices" (or legacy "matrix") entry: this build has no
// routing engine, and input with only coordinates returns error
// code 3, "VROOM compiled without routing support."
//
// exploration_level: CLI -x, clamped to 0..5 (CLI default 5).
// timeout_ms: CLI -l in milliseconds; negative means no limit.
EMSCRIPTEN_KEEPALIVE const char*
vroom_solve(const char* input, int exploration_level, int timeout_ms) {
  try {
    // Same construction as main.cpp; the servers map and router are
    // only read by routing code, which this build does not contain.
    vroom::Input problem(vroom::io::Servers{},
                         vroom::ROUTER::OSRM,
                         /* apply_TSPFix */ false);
    constexpr bool geometry = false;
    vroom::io::parse(problem, std::string(input), geometry);

    vroom::Timeout timeout;
    if (timeout_ms >= 0) {
      timeout = std::chrono::milliseconds(timeout_ms);
    }
    const auto level =
      std::min(static_cast<unsigned>(std::max(exploration_level, 0)),
               vroom::MAX_EXPLORATION_LEVEL);
    constexpr unsigned nb_threads = 1;

    const vroom::Solution sol = problem.solve(level, nb_threads, timeout);
    return store(vroom::io::to_json(sol, problem.report_distances()));
  } catch (const vroom::Exception& e) {
    return store(vroom::io::to_json(e));
  } catch (const std::exception& e) {
    return store(vroom::io::to_json(vroom::InternalException(e.what())));
  }
}

} // extern "C"
