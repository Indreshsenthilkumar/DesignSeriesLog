ObjC.import('AppKit');
function run(argv) {
    var inPath = argv[0];
    var outPath = argv[1];
    var radius = parseFloat(argv[2]);
    var image = $.NSImage.alloc.initWithContentsOfFile(inPath);
    if (!image) { console.log("Failed to load"); return; }
    var size = image.size;
    var rect = $.NSMakeRect(0, 0, size.width, size.height);
    var newImage = $.NSImage.alloc.initWithSize(size);
    newImage.lockFocus;
    var path = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(rect, radius, radius);
    path.addClip;
    image.drawInRect(rect);
    newImage.unlockFocus;
    var tiffData = newImage.TIFFRepresentation;
    var bitmap = $.NSBitmapImageRep.imageRepWithData(tiffData);
    var pngData = bitmap.representationUsingTypeProperties($.NSPNGFileType, $());
    pngData.writeToFileAtomically(outPath, true);
}
