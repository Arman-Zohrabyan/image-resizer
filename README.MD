# Image Processor

A Node.js application that processes images by resizing them, converting formats, and removing metadata.

## Features

- ✅ Upload multiple PNG and WebP images simultaneously
- ✅ No file size limitations (handles any image size)
- ✅ Smart resize: Centered crop to 720×480 (16:9 aspect ratio)
- ✅ No image distortion/stretching (maintains original aspect ratio)
- ✅ Convert to WebP format with adaptive quality compression
- ✅ Guarantee output files under 100KB (auto-optimizes quality)
- ✅ Preserve original filenames (sanitized)
- ✅ Remove all metadata (EXIF, GPS, etc.)
- ✅ Advanced WebP compression with effort optimization
- ✅ Drag & drop interface for multiple files
- ✅ Real-time preview of all selected images
- ✅ Batch processing with individual success/error reporting
- ✅ Download individual or all processed images

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Directory Structure

```
your-project/
├── server.js
├── package.json
├── public/
│   └── index.html
└── processed_images/ (created automatically)
```

### 3. Start the Server

For development (auto-restart on changes):
```bash
npm run dev
```

For production:
```bash
npm start
```

## Usage

1. Open your browser and go to `http://localhost:3000`
2. Upload multiple PNG or WebP images by:
   - Dragging and dropping them onto the upload area
   - Clicking "Select Images" to browse and select multiple files
3. Preview all your selected images in a grid layout
4. Click "Process All Images" to resize and convert all files
5. View processing results for each image (success/failure status)
6. Download individual processed images or all at once

## API Endpoints

### POST `/api/process-image`
Process multiple uploaded images.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body: Multiple image files with field name `images[]` (PNG or WebP)

**Response:**
```json
{
  "success": true,
  "message": "Processed 3 of 3 images successfully",
  "totalFiles": 3,
  "successCount": 3,
  "results": [
    {
      "success": true,
      "originalName": "photo1.png",
      "processedFilename": "photo1_720x480.webp",
      "size": 89534,
      "sizeKB": 87,
      "quality": 80,
      "dimensions": "720x480",
      "format": "WebP",
      "downloadUrl": "/download/photo1_720x480.webp"
    },
    {
      "success": false,
      "originalName": "corrupted.png",
      "error": "Invalid image format"
    }
  ]
}
```

### GET `/download/:filename`
Download a processed image.

**Response:** Binary image file

### GET `/api/image-info/:filename`
Get metadata about a processed image.

**Response:**
```json
{
  "width": 720,
  "height": 480,
  "format": "webp",
  "size": 35678
}
```

## Configuration

You can modify these settings in `server.js`:

- **Target dimensions:** Change `resize(720, 480, ...)` to your preferred size
- **Crop behavior:** Uses `fit: 'cover'` for centered cropping (change to `fit: 'fill'` to stretch instead)
- **Crop position:** Uses `position: 'center'` (can use 'top', 'bottom', 'left', 'right', etc.)
- **Output format:** Currently set to WebP (change `.webp(...)` to `.jpeg()`, `.png()`, etc.)
- **File size target:** Modify `compressToTarget(buffer, 100)` to change the KB limit
- **Starting quality:** Adjust the initial `quality = 90` in the compression function
- **Quality reduction step:** Change `quality -= 5` for different optimization steps
- **Compression effort:** Modify `effort: 6` (0-6, higher = better compression)
- **Multiple file limit:** Change `upload.array('images', 20)` to allow more/fewer files
- **Port:** Change `PORT = 3000` to your preferred port

## Smart Cropping Behavior

The system intelligently handles different aspect ratios:

### **16:9 Images (e.g., 1920×1080, 1280×720)**
- ✅ **No cropping needed** - resized proportionally to 720×480
- ✅ **Perfect fit** with no quality loss from cropping

### **Non-16:9 Images (e.g., 1792×1024, 4:3, square)**
- ✅ **Centered crop** to 16:9 aspect ratio
- ✅ **No stretching/distortion** - maintains image quality
- ✅ **Smart positioning** - keeps the most important center area

### **Examples:**
- `1792×1024` → Crops to `1792×1008` (center area) → Resizes to `720×480`
- `1080×1080` (square) → Crops to `1080×608` (center area) → Resizes to `720×480`
- `1920×1080` (16:9) → No cropping → Direct resize to `720×480`

This ensures all output images are exactly 720×480 with no distortion!

## Adaptive Compression Algorithm

The system uses an intelligent compression approach:

1. **Starts with high quality (90%)** for best visual results
2. **Iteratively reduces quality by 5%** if file exceeds 100KB
3. **Stops when target size is reached** or minimum quality (10%) is hit
4. **Uses advanced WebP features** (effort: 6, smart subsampling)
5. **Preserves original filenames** with sanitization for safety

This ensures every output file is under 100KB while maintaining the highest possible quality.

## File Size Guarantee

- **Input:** Any size/aspect ratio PNG/WebP image
- **Processing:** Centered crop to 16:9 aspect ratio (no distortion)
- **Output:** Always under 100KB WebP at exactly 720×480
- **Quality:** Automatically optimized (typically 60-90% depending on image complexity)
- **Filename:** `originalname_720x480.webp`

## WebP Advantages

- **Better compression:** 25-35% smaller files than JPEG at same quality
- **Higher quality:** Better detail preservation at lower file sizes
- **Advanced features:** Smart subsampling, better color handling
- **Universal support:** All modern browsers and devices
- **Perfect for web:** Optimized for fast loading

## Dependencies

- **express:** Web framework
- **multer:** File upload handling
- **sharp:** High-performance image processing
- **nodemon:** Development auto-reload (dev dependency)

## Error Handling

The application handles:
- Invalid file types
- Files too large (>10MB)
- Corrupted images
- Server processing errors
- Missing files

## Browser Support

The client works on all modern browsers that support:
- File API
- Drag and Drop API
- Fetch API
- FormData

## Security Considerations

- File type validation (only PNG/WebP allowed)
- File size limits
- Metadata removal prevents information leakage
- Memory-based upload processing (files aren't stored temporarily)

## License

MIT License
