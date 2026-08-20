// Emscripten entry point for SimulationCraft.
//
// Replaces sc_main.cpp. The native main() parses argv, sets up signal handlers
// and writes reports to the filesystem; none of that survives the browser, so
// this exposes a single C-callable function instead.
//
// IMPORTANT — how this differs from the obvious approach:
//
//   sim_t has no `parse_options(std::string)` and no `generate_json_report()`.
//   Options are parsed into a sim_control_t via option_db_t, handed to
//   sim_t::setup(), and reports are emitted by report::print_suite() to
//   whatever output paths the options named. So rather than reaching for an
//   internal JSON API whose signature moves between releases, we append a
//   `json2=` option pointing at Emscripten's in-memory filesystem, let simc
//   write the report exactly as it does natively, and read the file back.
//
//   That keeps this wrapper standing on three stable public symbols
//   (option_db_t::parse_text, sim_t::setup, report::print_suite) instead of
//   tracking the report internals.

#include "simulationcraft.hpp"

#include <emscripten.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

constexpr const char* kReportPath = "/tmp/sc_report.json";

/** Copies a std::string onto the heap for the JS side to read and free. */
char* to_heap(const std::string& text) {
  char* buffer = static_cast<char*>(std::malloc(text.size() + 1));
  if (!buffer) return nullptr;
  std::memcpy(buffer, text.c_str(), text.size() + 1);
  return buffer;
}

/** Wraps an error as a JSON document so the JS side has one shape to parse. */
char* error_json(const std::string& message) {
  std::string escaped;
  escaped.reserve(message.size() + 16);
  for (char c : message) {
    if (c == '"' || c == '\\') escaped += '\\';
    if (c == '\n') { escaped += "\\n"; continue; }
    escaped += c;
  }
  return to_heap("{\"error\":\"" + escaped + "\"}");
}

std::string read_file(const char* path) {
  std::FILE* file = std::fopen(path, "rb");
  if (!file) return {};
  std::string out;
  char chunk[8192];
  size_t read = 0;
  while ((read = std::fread(chunk, 1, sizeof(chunk), file)) > 0) out.append(chunk, read);
  std::fclose(file);
  return out;
}

}  // namespace

extern "C" {

/**
 * Runs one simulation.
 *
 * @param profile_text  A complete simc profile, exactly as you would paste into
 *                      the desktop client. Any options it sets are honoured.
 * @param iterations    Overrides the profile's iteration count when > 0. The
 *                      Web Worker pool uses this to split a run across cores.
 * @param seed          RNG seed. Each worker must pass a different one, or
 *                      every worker simulates the identical fight and the
 *                      aggregate has a fake standard error.
 *
 * @return  Heap-allocated JSON: either simc's json2 report, or
 *          `{"error": "..."}`. The caller must free it via sc_free().
 */
EMSCRIPTEN_KEEPALIVE
char* sc_run_simulation(const char* profile_text, int iterations, int seed) {
  if (!profile_text) return error_json("No profile text supplied.");

  try {
    auto sim = std::make_unique<sim_t>();
    sim_control_t control;

    std::string options(profile_text);
    options += "\njson2=";
    options += kReportPath;
    options += "\n";
    if (iterations > 0) options += "iterations=" + std::to_string(iterations) + "\n";
    if (seed != 0) options += "seed=" + std::to_string(seed) + "\n";

    // Single-threaded per module instance: parallelism comes from running one
    // instance per Web Worker, not from simc's own thread pool, which needs
    // pthreads + SharedArrayBuffer and the COOP/COEP headers that go with it.
    options += "threads=1\n";

    control.options.parse_text(options);

    if (!sim->setup(&control)) {
      return error_json("simc rejected the profile during setup.");
    }
    if (sim->canceled) {
      return error_json("Simulation was cancelled during setup.");
    }

    sim->execute();

    if (sim->canceled) {
      return error_json("Simulation was cancelled.");
    }

    report::print_suite(*sim);

    std::string json = read_file(kReportPath);
    std::remove(kReportPath);

    if (json.empty()) {
      return error_json("simc produced no JSON report.");
    }
    return to_heap(json);
  } catch (const std::exception& e) {
    return error_json(std::string("simc threw: ") + e.what());
  } catch (...) {
    return error_json("simc threw an unknown exception.");
  }
}

/** Frees a string returned by sc_run_simulation. */
EMSCRIPTEN_KEEPALIVE
void sc_free(char* pointer) {
  std::free(pointer);
}

/** Version banner, so the UI can show which engine build is loaded. */
EMSCRIPTEN_KEEPALIVE
char* sc_version() {
  return to_heap(std::string(SC_VERSION));
}

}  // extern "C"
