// Material-backed desktop blur. Only this owned NSVisualEffectView's layers are
// edited; the WKWebView, title controls and AppKit's frame/corner masks are not.
// The Zed source comparison and isolated native evidence live in tools/blur-probe/.
#import "macos_blur.h"
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <math.h>

static char stateKey;

// Never mutate a CAFilter already installed on a layer: CA can otherwise treat
// the filter array as unchanged and leave the rendered radius unchanged.
static NSInteger configureLayers(CALayer *layer, uint8_t radius, NSUInteger depth, NSUInteger *visited) {
    if (!layer || depth > 16 || ++*visited > 256) return -1;
    layer.backgroundColor = nil;
    if ([NSStringFromClass(layer.class) isEqualToString:@"CAChameleonLayer"]) {
        layer.hidden = YES; // AppKit's desktop tint, not its blur.
        return 0;
    }
    NSInteger gaussianCount = 0;
    NSMutableArray *filters = [NSMutableArray new];
    for (id filter in layer.filters) {
        NSString *description = [filter description];
        if ([description containsString:@"Saturat"]) continue;
        if ([description containsString:@"gaussianBlur"]) {
            if (![filter respondsToSelector:@selector(copyWithZone:)]) return -1;
            id replacement = [filter copy];
            if (!replacement) return -1;
            [replacement setValue:@(radius) forKey:@"inputRadius"];
            [filters addObject:replacement];
            ++gaussianCount;
        } else {
            [filters addObject:filter];
        }
    }
    if (gaussianCount || filters.count != layer.filters.count) layer.filters = filters;
    for (CALayer *child in layer.sublayers) {
        NSInteger count = configureLayers(child, radius, depth + 1, visited);
        if (count < 0) return -1;
        gaussianCount += count;
    }
    return gaussianCount;
}

@interface NimrodWindowBlurView : NSVisualEffectView
@property uint8_t radius;
@property int32_t fault;
@property BOOL detached;
@property(copy) NimrodBlurFailure failure;
- (void)fail:(int32_t)status;
@end

@implementation NimrodWindowBlurView
// The backdrop must never become an input/focus owner, including in the title bar.
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)acceptsFirstResponder { return NO; }
- (BOOL)isOpaque { return NO; }
- (void)fail:(int32_t)status {
    if (self.fault || self.detached) return;
    self.fault = status;
    self.hidden = YES; // Plain transparency, never the stock dense material.
    if (self.failure) self.failure(status);
}
- (void)updateLayer {
    if (self.detached || self.fault) return;
    @try {
        [super updateLayer];
        if (!self.radius || NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) {
            self.hidden = YES;
            return;
        }
        NSUInteger visited = 0;
        if (configureLayers(self.layer, self.radius, 0, &visited) <= 0) {
            [self fail:4];
            return;
        }
        self.hidden = NO;
    } @catch (NSException *exception) {
        [self fail:5];
    }
}
@end

@interface NimrodWindowBlurState : NSObject
@property(weak) NSWindow *window;
@property NimrodWindowBlurView *view;
@property NSMutableArray *observers;
- (BOOL)attach;
@end

// A single public NSView ancestry hop provides the full native frame, not just
// the content rectangle. This covers the Transparent title bar without enabling
// FullSizeContentView, changing content geometry, or reparenting the WKWebView.
static NSView *frameHost(NSWindow *window) {
    NSView *content = window.contentView;
    NSView *host = content.superview;
    if (!content || !host || host.window != window) return nil;
    [host layoutSubtreeIfNeeded];
    NSRect c = [content convertRect:content.bounds toView:host];
    NSRect h = host.bounds;
    if (h.size.width <= 0 || h.size.height <= 0 ||
        fabs(h.size.width - c.size.width) > 2 ||
        h.size.height < c.size.height || h.size.height - c.size.height > 120 ||
        !NSContainsRect(NSInsetRect(h, -1, -1), c)) return nil;
    return host;
}

@implementation NimrodWindowBlurState
- (BOOL)attach {
    NSWindow *window = self.window;
    NSView *host = window ? frameHost(window) : nil;
    if (!host) return NO;
    if (self.view.superview != host) {
        [self.view removeFromSuperview];
        [host addSubview:self.view positioned:NSWindowBelow relativeTo:nil];
    }
    if (!NSEqualRects(self.view.frame, host.bounds)) self.view.frame = host.bounds;
    return YES;
}
- (void)dealloc {
    for (id observer in self.observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
}
@end

static void removeBlur(NSWindow *window) {
    NimrodWindowBlurState *state = objc_getAssociatedObject(window, &stateKey);
    state.view.detached = YES;
    state.view.failure = nil;
    [state.view removeFromSuperview];
    objc_setAssociatedObject(window, &stateKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

int32_t nimrod_blur_supported(void) {
    if (!NSThread.isMainThread) return 0;
    return NSClassFromString(@"CABackdropLayer") && NSClassFromString(@"CAFilter") &&
        [NSVisualEffectView instancesRespondToSelector:@selector(updateLayer)];
}

int32_t nimrod_blur_apply(void *pointer, uint8_t radius, NimrodBlurFailure failure) {
    if (!NSThread.isMainThread || !pointer) return 2;
    if (radius > 40) return 3;
    NSWindow *window = (__bridge NSWindow *)pointer;
    @try {
        // The native check is authoritative even if accessibility changed since
        // the frontend last refreshed its capabilities.
        if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) radius = 0;
        if (radius == 0) {
            removeBlur(window);
            return 0;
        }
        if (!nimrod_blur_supported()) return 1;
        NimrodWindowBlurState *state = objc_getAssociatedObject(window, &stateKey);
        if (!state) {
            NSView *host = frameHost(window);
            if (!host) return 2;
            state = [NimrodWindowBlurState new];
            state.window = window;
            state.view = [[NimrodWindowBlurView alloc] initWithFrame:host.bounds];
            state.view.radius = radius;
            state.view.material = NSVisualEffectMaterialUnderWindowBackground;
            state.view.blendingMode = NSVisualEffectBlendingModeBehindWindow;
            state.view.state = NSVisualEffectStateActive;
            state.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
            objc_setAssociatedObject(window, &stateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            state.observers = [NSMutableArray new];
            __weak NimrodWindowBlurState *weakState = state;
            for (NSNotificationName name in @[NSWindowDidResizeNotification, NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification, NSWindowWillCloseNotification]) {
                id observer = [NSNotificationCenter.defaultCenter addObserverForName:name object:window queue:nil usingBlock:^(NSNotification *note) {
                    NimrodWindowBlurState *owner = weakState;
                    if (!owner) return;
                    if ([note.name isEqualToString:NSWindowWillCloseNotification]) {
                        removeBlur(note.object);
                        return;
                    }
                    if (owner.view.detached || owner.view.fault) return;
                    @try {
                        if (![owner attach]) [owner.view fail:2];
                    } @catch (NSException *exception) {
                        [owner.view fail:5];
                    }
                }];
                [state.observers addObject:observer];
            }
        }
        // Detach the previous request's reporter before reconfiguration. Initial
        // failures return synchronously; only later AppKit rebuilds use the block.
        state.view.failure = nil;
        state.view.radius = radius;
        state.view.fault = 0;
        if (![state attach]) { removeBlur(window); return 2; }
        state.view.hidden = NO;
        state.view.wantsLayer = YES;
        [state.view updateLayer];
        int32_t fault = state.view.fault;
        if (fault) { removeBlur(window); return fault; }
        state.view.failure = failure; // copy; released with the owned view at zero/close
        return 0;
    } @catch (NSException *exception) {
        removeBlur(window);
        return 5;
    }
}
