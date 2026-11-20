import Vision
import CoreImage
import AppKit
let a = CommandLine.arguments
let url = URL(fileURLWithPath: a[1]); let out = URL(fileURLWithPath: a[2])
let ci = CIImage(contentsOf: url)!
let h = VNImageRequestHandler(ciImage: ci)
let r = VNGenerateForegroundInstanceMaskRequest()
try h.perform([r])
guard let res = r.results?.first else { print("no subject"); exit(1) }
print("instances:", res.allInstances.count)
// pick instance at a given normalized point (x,y from top-left), default centre
let px = Double(a.count > 3 ? a[3] : "0.5")!, py = Double(a.count > 4 ? a[4] : "0.55")!
let mask = res.instanceMask
CVPixelBufferLockBaseAddress(mask, .readOnly)
let w = CVPixelBufferGetWidth(mask), hh = CVPixelBufferGetHeight(mask), bpr = CVPixelBufferGetBytesPerRow(mask)
let base = CVPixelBufferGetBaseAddress(mask)!.assumingMemoryBound(to: UInt8.self)
let id = Int(base[Int(py*Double(hh))*bpr + Int(px*Double(w))])
CVPixelBufferUnlockBaseAddress(mask, .readOnly)
print("picked instance", id)
let set: IndexSet = id == 0 ? res.allInstances : IndexSet(integer: id)
let pb = try res.generateMaskedImage(ofInstances: set, from: h, croppedToInstancesExtent: true)
let outCI = CIImage(cvPixelBuffer: pb)
let rep = NSBitmapImageRep(ciImage: outCI)
try rep.representation(using: .png, properties: [:])!.write(to: out)
print("wrote", out.path, outCI.extent)
