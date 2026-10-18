// Isolated native blur investigation. Never opens Nimrod, a session, or remote content.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <QuartzCore/QuartzCore.h>
#import <ImageIO/ImageIO.h>
#import <CoreMedia/CoreMedia.h>
#import <dlfcn.h>
#import <stdatomic.h>

static int (*connectionID)(void);
static int (*threadConnectionID)(void);
static int (*setRadius)(int, uint32_t, uint32_t);
static int (*setRadiusStyle)(int, uint32_t, uint32_t, bool);
static int (*setRadiusHint)(int, uint32_t, uint32_t, float);
static int (*disableUpdates)(int);
static int (*reenableUpdates)(int);
static atomic_int phaseIndex;
static CFTimeInterval started;
static NSString *output;
static BOOL batched, alternateStyle;
static NSDictionary *options;
static int resultCode = 1;

@interface Scene : NSView
@property BOOL backdrop;
@end
@implementation Scene
- (BOOL)isOpaque { return self.backdrop; }
- (void)drawRect:(NSRect)dirty {
    if (self.backdrop) {
        for (int y = 0; y < self.bounds.size.height; y += 20) {
            for (int x = 0; x < self.bounds.size.width; x += 20) {
                [((x/20+y/20)%2 ? [NSColor colorWithSRGBRed:.9 green:.72 blue:.3 alpha:1] : [NSColor colorWithSRGBRed:.12 green:.25 blue:.52 alpha:1]) setFill];
                NSRectFill(NSMakeRect(x,y,20,20));
            }
        }
    } else {
        [[NSColor colorWithSRGBRed:.08 green:.1 blue:.14 alpha:.5] setFill];
        NSRectFillUsingOperation(self.bounds, NSCompositingOperationSourceOver);
    }
    if (self.backdrop && [options[@"landmarks"] boolValue]) {
        [[NSColor colorWithSRGBRed:.95 green:.2 blue:.1 alpha:1] setFill];
        NSRectFill(NSMakeRect(0,300,self.bounds.size.width,110));
        [[NSColor colorWithSRGBRed:.1 green:.8 blue:.55 alpha:1] setFill];
        NSRectFill(NSMakeRect(0,130,self.bounds.size.width,110));
    }
    NSDictionary *attrs = @{NSFontAttributeName:[NSFont monospacedSystemFontOfSize:20 weight:NSFontWeightBold], NSForegroundColorAttributeName:NSColor.whiteColor};
    for (int i=0;i<8;i++) [@"STATIC FIXTURE 012345" drawAtPoint:NSMakePoint(16,20+i*42) withAttributes:attrs];
}
@end

// Independently implemented probe of Zed's material policy: clear layer fills,
// hide desktop-tint layers, and remove saturation filters after AppKit updates.
// Pinned source and scope are documented in upstream-comparison.md.
static NSInteger stripMaterialTint(CALayer *layer, NSNumber *radius) {
    NSInteger adjusted=0;
    layer.backgroundColor = nil;
    if ([NSStringFromClass(layer.class) isEqualToString:@"CAChameleonLayer"]) {
        layer.hidden = YES;
        return 0;
    }
    NSMutableArray *filters = [NSMutableArray new];
    for (id filter in layer.filters) {
        if ([[filter description] containsString:@"Saturat"]) continue;
        if (radius && [[filter description] containsString:@"gaussianBlur"]) {
            // Replace, rather than mutate the object already installed in the
            // layer: equal filter-array identities can suppress a CA update.
            id replacement=[filter copy];
            [replacement setValue:radius forKey:@"inputRadius"];
            [filters addObject:replacement];
            ++adjusted;
            continue;
        }
        [filters addObject:filter];
    }
    if (adjusted || filters.count != layer.filters.count) layer.filters = filters;
    for (CALayer *child in layer.sublayers) adjusted+=stripMaterialTint(child,radius);
    return adjusted;
}
@interface ZedProbeEffect : NSVisualEffectView
@property NSNumber *probeRadius;
@property NSNumber *loggedRadius;
@end
@implementation ZedProbeEffect
- (void)updateLayer {
    [super updateLayer];
    NSInteger adjusted=self.layer ? stripMaterialTint(self.layer,self.probeRadius) : 0;
    if (self.probeRadius && ![self.probeRadius isEqual:self.loggedRadius]) {
        NSLog(@"material requested radius=%@ configured gaussian filters=%ld",self.probeRadius,adjusted);
        self.loggedRadius=self.probeRadius;
    }
}
@end

@interface Probe : NSObject <NSApplicationDelegate, SCStreamOutput, SCStreamDelegate>
@property NSMutableArray<NSWindow *> *windows;
@property SCStream *stream;
@property dispatch_queue_t captureQueue;
@property FILE *metrics;
@property int frameNumber;
@property NSRect backdropFrame;
@property NSMutableDictionary<NSNumber *, NSVisualEffectView *> *effectViews;
@end
@implementation Probe
- (NSWindow *)windowAt:(NSRect)rect title:(NSString *)title web:(BOOL)web backdrop:(BOOL)backdrop {
    NSWindow *w = [[NSWindow alloc] initWithContentRect:rect styleMask:backdrop ? NSWindowStyleMaskBorderless : NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    w.releasedWhenClosed = NO;
    // Display capture is restricted to the interior of the opaque backdrop.
    // Keep that privacy shield above ordinary apps for the entire stream.
    if ([options[@"displayCapture"] boolValue]) {
        w.level = CGShieldingWindowLevel() + (backdrop ? 1 : 2);
        w.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorFullScreenAuxiliary;
    }
    w.title = title;
    if (!backdrop && options[@"windowAlpha"]) w.alphaValue = [options[@"windowAlpha"] doubleValue];
    w.titlebarAppearsTransparent = YES;
    w.opaque = backdrop;
    double alpha = options[@"backingAlpha"] ? [options[@"backingAlpha"] doubleValue] : .0001;
    w.backgroundColor = !backdrop && [options[@"whiteBacking"] boolValue]
        ? [NSColor.whiteColor colorWithAlphaComponent:alpha]
        : [NSColor colorWithSRGBRed:0 green:0 blue:0 alpha:backdrop ? 1 : alpha];
    w.hasShadow = !backdrop && !(options[@"noShadow"] && [options[@"noShadow"] boolValue]);
    w.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    if (web) {
        WKWebViewConfiguration *config = [WKWebViewConfiguration new];
        config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
        WKWebView *view = [[WKWebView alloc] initWithFrame:NSMakeRect(0,0,rect.size.width,rect.size.height) configuration:config];
        // This is the same WKWebView transparent-backing switch used by Wry.
        [view setValue:@NO forKey:@"drawsBackground"];
        w.contentView = view;
        [view loadHTMLString:@"<!doctype html><style>html{background:transparent}body{margin:0;min-height:100vh;background:rgba(20,26,36,.5);color:white;font:bold 20px monospace}p{margin:0;padding:12px 16px}</style><p>STATIC FIXTURE 012345</p><p>STATIC FIXTURE 012345</p><p>STATIC FIXTURE 012345</p><p>STATIC FIXTURE 012345</p><p>STATIC FIXTURE 012345</p><p>STATIC FIXTURE 012345</p><p>STATIC FIXTURE 012345</p><p>STATIC FIXTURE 012345</p>" baseURL:nil];
    } else {
        Scene *scene = [[Scene alloc] initWithFrame:NSMakeRect(0,0,rect.size.width,rect.size.height)];
        scene.backdrop = backdrop;
        scene.wantsLayer = !backdrop && ![options[@"unlayered"] boolValue];
        w.contentView = scene;
    }
    if (!backdrop && options[@"material"]) {
        NSView *front = w.contentView;
        NSView *container = [[NSView alloc] initWithFrame:front.bounds];
        front.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        w.contentView = container;
        [container addSubview:front];
    }
    if (!backdrop && [options[@"noFlatten"] boolValue]) [w setValue:@NO forKey:@"shouldAutoFlattenLayerTree"];
    if (!backdrop && [options[@"rehost"] boolValue]) {
        [w setValue:@NO forKey:@"canHostLayersInWindowServer"];
        [w setValue:@YES forKey:@"canHostLayersInWindowServer"];
    }
    [self.windows addObject:w];
    [w orderFront:nil];
    [w invalidateShadow];
    return w;
}
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSLog(@"capture permission=%d screen=%@ batch=%d alternateStyle=%d", CGPreflightScreenCaptureAccess(), NSStringFromRect(NSScreen.mainScreen.frame), batched, alternateStyle);
    if (!CGPreflightScreenCaptureAccess()) {
        NSLog(@"Requesting Screen Recording permission for the isolated fixture; approve Nimrod Blur Probe, then rerun.");
        CGRequestScreenCaptureAccess();
        [NSApp terminate:nil]; return;
    }
    self.windows = [NSMutableArray new];
    self.effectViews = [NSMutableDictionary new];
    NSRect visible = NSScreen.mainScreen.visibleFrame;
    self.backdropFrame = NSMakeRect(visible.origin.x+40,visible.origin.y+40,1080,560);
    if (!NSContainsRect(visible,self.backdropFrame)) { NSLog(@"Screen is too small for the complete fixture; aborting"); [NSApp terminate:nil]; return; }
    [self windowAt:self.backdropFrame title:@"Blur probe synthetic backdrop" web:NO backdrop:YES];
    for (int i=0;i<3;i++) [self windowAt:NSMakeRect(self.backdropFrame.origin.x+30+i*350,self.backdropFrame.origin.y+80,320,400) title:@[@"AppKit target",@"WKWebView target",@"Untouched control"][i] web:i!=0 backdrop:NO];
    [NSApp activateIgnoringOtherApps:YES];
    for (NSWindow *w in self.windows) [w displayIfNeeded];
    // WindowServer must see the initial windows before SCShareableContent takes
    // its snapshot. A snapshot taken in didFinishLaunching can contain none.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,2*NSEC_PER_SEC),dispatch_get_main_queue(), ^{
        for (NSWindow *w in self.windows) NSLog(@"fixture id=%ld visible=%d frame=%@",w.windowNumber,w.visible,NSStringFromRect(w.frame));
        [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO completionHandler:^(SCShareableContent *content, NSError *error) {
            if (error) { NSLog(@"shareable content: %@",error); dispatch_async(dispatch_get_main_queue(), ^{[NSApp terminate:nil];}); return; }
            dispatch_async(dispatch_get_main_queue(), ^{[self startCapture:content];});
        }];
    });
}
- (void)startCapture:(SCShareableContent *)content {
    NSNumber *screenID = NSScreen.mainScreen.deviceDescription[@"NSScreenNumber"];
    SCDisplay *display = nil;
    for (SCDisplay *d in content.displays) if (d.displayID == screenID.unsignedIntValue) display=d;
    NSMutableArray *ownWindows = [NSMutableArray new];
    for (SCWindow *w in content.windows) {
        for (NSWindow *native in self.windows) if (w.windowID == native.windowNumber) {
            NSLog(@"capture fixture id=%u pid=%d onScreen=%d frame=%@",w.windowID,w.owningApplication.processID,w.onScreen,NSStringFromRect(w.frame));
            [ownWindows addObject:w];
        }
    }
    NSLog(@"found %lu fixture windows; capture=%@",ownWindows.count,[options[@"displayCapture"] boolValue] ? @"cropped shielded display" : @"own-window filter");
    if (!display || ownWindows.count != 4) { NSLog(@"Incomplete fixture capture; aborting"); [NSApp terminate:nil]; return; }
    SCContentFilter *filter = [options[@"displayCapture"] boolValue]
        ? [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]]
        : [[SCContentFilter alloc] initWithDisplay:display includingWindows:ownWindows];
    SCStreamConfiguration *config = [SCStreamConfiguration new];
    NSRect screen = NSScreen.mainScreen.frame;
    config.sourceRect = CGRectMake(self.backdropFrame.origin.x-screen.origin.x,NSMaxY(screen)-NSMaxY(self.backdropFrame),1080,560);
    config.width=1080; config.height=560;
    config.minimumFrameInterval=CMTimeMake(1,60);
    config.queueDepth=8;
    config.showsCursor=NO;
    config.capturesAudio=NO;
    config.pixelFormat=kCVPixelFormatType_32BGRA;
    self.captureQueue=dispatch_queue_create("nimrod.blur-probe.capture",DISPATCH_QUEUE_SERIAL);
    self.metrics=fopen([[output stringByAppendingPathComponent:@"frames.csv"] fileSystemRepresentation],"w");
    if (!self.metrics) { NSLog(@"Cannot create metrics file"); [NSApp terminate:nil]; return; }
    fprintf(self.metrics,"frame,time,phase,left_r,left_g,left_b,middle_r,middle_g,middle_b,control_r,control_g,control_b\n");
    self.stream=[[SCStream alloc] initWithFilter:filter configuration:config delegate:self];
    NSError *error=nil;
    [self.stream addStreamOutput:self type:SCStreamOutputTypeScreen sampleHandlerQueue:self.captureQueue error:&error];
    if (error) { NSLog(@"capture output error %@",error); [NSApp terminate:nil]; return; }
    [self.stream startCaptureWithCompletionHandler:^(NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (error) { NSLog(@"capture start error %@",error); [NSApp terminate:nil]; return; }
            started=CACurrentMediaTime();
            [self schedulePhase:0];
        });
    }];
}
- (void)schedulePhase:(int)phase {
    // Isolate each target first; the final two transitions change both together.
    const int radii[]={0,7,20,0,7,0,7,20,0,7,0,7,0};
    const int targets[]={0,1,1,1,1,1,2,2,2,2,2,3,3};
    if (phase>=13) {
        [self.stream stopCaptureWithCompletionHandler:^(NSError *error){
            dispatch_async(self.captureQueue, ^{
                if(self.metrics) {fclose(self.metrics);self.metrics=NULL;}
                dispatch_async(dispatch_get_main_queue(), ^{ resultCode = error ? 1 : 0; NSLog(@"COMPLETE %@ error=%@",output,error); [NSApp terminate:nil]; });
            });
        }];
        return;
    }
    atomic_store(&phaseIndex,phase);
    int cid=[options[@"threadConnection"] boolValue] ? threadConnectionID() : connectionID();
    if (phase==0) NSLog(@"main connection=%d selected connection=%d threadDefault=%d",connectionID(),cid,[options[@"threadConnection"] boolValue]);
    CFTimeInterval before=CACurrentMediaTime();
    int begin=batched ? disableUpdates(cid) : 0;
    if (begin==0) {
        for (int i=1;i<=2;i++) if (targets[phase]&i) {
            if (options[@"material"]) {
                NSVisualEffectView *effect=self.effectViews[@(i)];
                if (radii[phase]==0) {
                    [effect removeFromSuperview];
                    [self.effectViews removeObjectForKey:@(i)];
                } else if (!effect) {
                    NSView *container=self.windows[i].contentView;
                    Class effectClass=[options[@"material"] isEqual:@"zed"] ? ZedProbeEffect.class : NSVisualEffectView.class;
                    effect=[[effectClass alloc] initWithFrame:container.bounds];
                    effect.material=NSVisualEffectMaterialUnderWindowBackground;
                    effect.blendingMode=NSVisualEffectBlendingModeBehindWindow;
                    effect.state=NSVisualEffectStateActive;
                    effect.autoresizingMask=NSViewWidthSizable | NSViewHeightSizable;
                    [container addSubview:effect positioned:NSWindowBelow relativeTo:nil];
                    self.effectViews[@(i)]=effect;
                }
                if ([options[@"materialRadius"] boolValue] && [effect isKindOfClass:ZedProbeEffect.class] && radii[phase]!=0) {
                    ((ZedProbeEffect *)effect).probeRadius=@(radii[phase]);
                    effect.needsDisplay=YES;
                }
                NSLog(@"phase=%d time=%.6f target=%d material=%@ enabled=%d radiusOverride=%d",phase,before-started,i,options[@"material"],radii[phase]!=0,[options[@"materialRadius"] boolValue]);
                continue;
            }
            if ([options[@"ghosttySync"] boolValue]) {
                // Mirror TerminalWindow.syncAppearance's numeric-blur path,
                // not its separate glass materials or renderer implementation.
                NSWindow *w=self.windows[i];
                w.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
                w.hasShadow=YES;
                w.opaque=NO;
                w.backgroundColor=[NSColor.whiteColor colorWithAlphaComponent:.001];
            }
            int status=options[@"opacityHint"] && setRadiusHint
                ? setRadiusHint(cid,(uint32_t)self.windows[i].windowNumber,radii[phase],[options[@"opacityHint"] floatValue])
                : alternateStyle ? setRadiusStyle(cid,(uint32_t)self.windows[i].windowNumber,radii[phase],false) : setRadius(cid,(uint32_t)self.windows[i].windowNumber,radii[phase]);
            if ([options[@"redraw"] boolValue]) [self.windows[i] display];
            NSLog(@"phase=%d time=%.6f target=%d radius=%d status=%d",phase,before-started,i,radii[phase],status);
        }
    }
    if ([options[@"flush"] boolValue]) [CATransaction flush];
    int resume=batched && begin==0 ? reenableUpdates(cid) : 0;
    NSLog(@"phase=%d batch begin=%d resume=%d elapsed=%.6f",phase,begin,resume,CACurrentMediaTime()-before);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (phase==0 ? 2 : 1)*NSEC_PER_SEC),dispatch_get_main_queue(), ^{[self schedulePhase:phase+1];});
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    if(type!=SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample) || !self.metrics) return;
    CVPixelBufferRef buffer=CMSampleBufferGetImageBuffer(sample);
    if(!buffer) return;
    CVPixelBufferLockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly);
    uint8_t *bytes=CVPixelBufferGetBaseAddress(buffer);
    size_t stride=CVPixelBufferGetBytesPerRow(buffer),width=CVPixelBufferGetWidth(buffer),height=CVPixelBufferGetHeight(buffer);
    int frame=self.frameNumber++, phase=atomic_load(&phaseIndex);
    fprintf(self.metrics,"%d,%.6f,%d",frame,CACurrentMediaTime()-started,phase);
    for(int region=0;region<3;region++) {
        double r=0,g=0,b=0,n=0;
        for(int y=100;y<440;y+=4) for(int x=50+region*350;x<330+region*350;x+=4) {
            if(x>=width || y>=height) continue;
            const uint8_t *p=bytes+y*stride+x*4; b+=p[0];g+=p[1];r+=p[2];n++;
        }
        fprintf(self.metrics,",%.4f,%.4f,%.4f",r/n,g/n,b/n);
    }
    fprintf(self.metrics,"\n");
    // Lossless compositor frames: own-window filter, or the cropped interior
    // of the opaque elevated synthetic backdrop in displayCapture mode.
    CGColorSpaceRef color=CGColorSpaceCreateDeviceRGB();
    CGContextRef context=CGBitmapContextCreate(bytes,width,height,8,stride,color,kCGImageAlphaPremultipliedFirst|kCGBitmapByteOrder32Little);
    CGImageRef image=CGBitmapContextCreateImage(context);
    NSURL *url=[NSURL fileURLWithPath:[output stringByAppendingPathComponent:[NSString stringWithFormat:@"frame-%04d-p%02d.png",frame,phase]]];
    CGImageDestinationRef destination=CGImageDestinationCreateWithURL((__bridge CFURLRef)url,CFSTR("public.png"),1,NULL);
    CGImageDestinationAddImage(destination,image,NULL); CGImageDestinationFinalize(destination);
    CFRelease(destination); CGImageRelease(image); CGContextRelease(context); CGColorSpaceRelease(color);
    CVPixelBufferUnlockBaseAddress(buffer,kCVPixelBufferLock_ReadOnly);
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error { NSLog(@"capture stopped: %@",error); dispatch_async(dispatch_get_main_queue(),^{[NSApp terminate:nil];}); }
@end

int main(int argc,const char **argv) {
    @autoreleasepool {
        output=argc>1 ? @(argv[1]) : @"/tmp/nimrod-blur-probe";
        batched=argc>2 && strcmp(argv[2],"batch")==0;
        alternateStyle=argc>3 && strcmp(argv[3],"style0")==0;
        [[NSFileManager defaultManager] createDirectoryAtPath:output withIntermediateDirectories:YES attributes:nil error:nil];
        NSData *config = [NSData dataWithContentsOfFile:[output stringByAppendingPathComponent:@"options.json"]];
        options = config ? [NSJSONSerialization JSONObjectWithData:config options:0 error:nil] : @{};
        if (![options isKindOfClass:NSDictionary.class]) { NSLog(@"options.json must be an object"); return 2; }
        if ([[NSFileManager defaultManager] fileExistsAtPath:[output stringByAppendingPathComponent:@"frames.csv"]]) {
            NSLog(@"Output already contains a capture; choose a fresh directory"); return 2;
        }
        void *handle=dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",RTLD_LAZY);
        connectionID=dlsym(handle,"CGSMainConnectionID"); setRadius=dlsym(handle,"CGSSetWindowBackgroundBlurRadius");
        threadConnectionID=dlsym(handle,"CGSDefaultConnectionForThread");
        setRadiusStyle=dlsym(handle,"SLSSetWindowBackgroundBlurRadiusStyle");
        setRadiusHint=dlsym(handle,"SLSSetWindowBackgroundBlurRadiusWithOpacityHint");
        disableUpdates=dlsym(handle,"SLSDisableUpdate"); reenableUpdates=dlsym(handle,"SLSReenableUpdate");
        if(!connectionID || !setRadius || (options[@"threadConnection"] && !threadConnectionID) || (batched && (!disableUpdates || !reenableUpdates)) || (alternateStyle && !setRadiusStyle) || (options[@"opacityHint"] && !setRadiusHint)) return 2;
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        Probe *delegate=[Probe new]; NSApp.delegate=delegate;
        [NSApp run];
    }
    return resultCode;
}
