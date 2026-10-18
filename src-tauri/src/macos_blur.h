// Main-thread-only bridge. The Objective-C boundary catches private API exceptions.
#pragma once
#include <stdint.h>

typedef void (^NimrodBlurFailure)(int32_t status);
int32_t nimrod_blur_supported(void);
int32_t nimrod_blur_apply(void *window, uint8_t radius, NimrodBlurFailure failure);

// Status: 0 success; 1 unavailable runtime; 2 invalid host; 3 invalid radius;
// 4 unsupported material/filter tree; 5 Objective-C exception.
