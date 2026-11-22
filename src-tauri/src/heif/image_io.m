#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

// The caller owns the returned CFData. Only the display copy is encoded as JPEG.
CFDataRef picker_heif_preview(const char *path, int edge, bool thumbnail) {
    @autoreleasepool {
        NSURL *url = [NSURL fileURLWithFileSystemRepresentation:path isDirectory:NO relativeToURL:nil];
        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
        if (!source) return NULL;
        size_t index = 0;
        if (@available(macOS 10.14, *)) index = CGImageSourceGetPrimaryImageIndex(source);
        NSMutableDictionary *options = [@{
            (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize: @(edge),
            (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform: @YES
        } mutableCopy];
        CGImageRef image = CGImageSourceCreateThumbnailAtIndex(source, index, (__bridge CFDictionaryRef)options);
        if (image && !thumbnail && MAX(CGImageGetWidth(image), CGImageGetHeight(image)) < (size_t)MIN(edge, 1616)) {
            CGImageRelease(image);
            image = NULL;
        }
        if (!image) {
            options[(__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways] = @YES;
            image = CGImageSourceCreateThumbnailAtIndex(source, index, (__bridge CFDictionaryRef)options);
        }
        CFRelease(source);
        if (!image) return NULL;
        NSMutableData *data = [NSMutableData data];
        CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, CFSTR("public.jpeg"), 1, NULL);
        bool ok = false;
        if (dest) {
            NSDictionary *properties = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @0.85};
            CGImageDestinationAddImage(dest, image, (__bridge CFDictionaryRef)properties);
            ok = CGImageDestinationFinalize(dest);
            CFRelease(dest);
        }
        CGImageRelease(image);
        return ok ? (__bridge_retained CFDataRef)data : NULL;
    }
}
