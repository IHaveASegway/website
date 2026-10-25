// Linked into the SANITIZE=1 build only, never shipped.
//
// By default AddressSanitizer records a stack trace on every malloc
// and free. Under Emscripten each trace is a walk of the JS stack, and
// VROOM allocates constantly, so a 60-stop solve took 41 s instead of
// 80 ms. With malloc_context_size=0 the checks are the same; a report
// just lacks the allocation and free stacks.
extern "C" const char* __asan_default_options() {
  return "malloc_context_size=0";
}
