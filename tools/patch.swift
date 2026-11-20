import Foundation
import CoreImage
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
// args: in out cx cy(top-left origin) len thick angleDeg blur darken
let a = CommandLine.arguments
let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[1]) as CFURL, nil)!
let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
let W = img.width, H = img.height
let cx = Double(a[3])!, cy = Double(a[4])!, len = Double(a[5])!, th = Double(a[6])!, ang = Double(a[7])! * .pi/180, br = Double(a[8])!, dk = Double(a[9])!
let ctx = CIContext()
let ci = CIImage(cgImage: img)
let blurred = ci.clampedToExtent().applyingGaussianBlur(sigma: br)
  .applyingFilter("CIColorControls", parameters: ["inputBrightness": -dk, "inputSaturation": 0.6])
  .cropped(to: ci.extent)
let bcg = ctx.createCGImage(blurred, from: ci.extent)!
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let g = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
g.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))
// feathered band: draw several nested clips with decreasing alpha
let steps = 8
for i in 0..<steps {
  let f = Double(i)/Double(steps)
  g.saveGState()
  g.translateBy(x: cx, y: Double(H) - cy)
  g.rotate(by: -ang)
  let l = len*(1.0 - 0.25*f), t = th*(1.0 - 0.5*f)
  g.addPath(CGPath(roundedRect: CGRect(x: -l/2, y: -t/2, width: l, height: t), cornerWidth: t/2, cornerHeight: t/2, transform: nil))
  g.clip()
  g.rotate(by: ang); g.translateBy(x: -cx, y: -(Double(H) - cy))
  g.setAlpha(i == 0 ? 0.35 : 0.25)
  g.draw(bcg, in: CGRect(x: 0, y: 0, width: W, height: H))
  g.restoreGState()
}
// keep original alpha: mask result by source alpha
let out = g.makeImage()!
let maskedCtx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
maskedCtx.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))
maskedCtx.setBlendMode(.sourceIn)
maskedCtx.draw(out, in: CGRect(x: 0, y: 0, width: W, height: H))
let dst = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dst, maskedCtx.makeImage()!, nil); CGImageDestinationFinalize(dst)
print("ok", W, H)
