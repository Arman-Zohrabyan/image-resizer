const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { removeBackground } = require('@imgly/background-removal-node');

const app = express();
const PORT = 3000;

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  // No file size limits
  fileFilter: (req, file, cb) => {
    // Accept only PNG and WebP images
    if (file.mimetype === 'image/png' || file.mimetype === 'image/webp') {
      cb(null, true);
    } else {
      cb(new Error('Only PNG and WebP images are allowed'), false);
    }
  }
});

// Function to sanitize filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .substring(0, 100); // Limit length
};

const ALLOWED_FITS = ['cover', 'contain', 'fill', 'inside', 'outside'];

// Resize an image and compress it under a target file size.
const compressToTarget = async (buffer, { width, height, fit, targetSizeKB, brightness, removeBg }) => {
  const targetSizeBytes = targetSizeKB * 1024;

  let workingBuffer = buffer;
  if (removeBg) {
    // The library decodes by MIME and a raw Buffer arrives without one.
    // Re-encode through sharp to a known PNG so detection always works.
    const pngBuffer = await sharp(buffer).png().toBuffer();
    const inputBlob = new Blob([pngBuffer], { type: 'image/png' });
    const blob = await removeBackground(inputBlob, { output: { format: 'image/png' } });
    workingBuffer = Buffer.from(await blob.arrayBuffer());
  }

  // Resize once into a raw pixel buffer; re-encoding in the loop is then cheap.
  const resizeOpts = {
    fit,
    background: removeBg
      ? { r: 0, g: 0, b: 0, alpha: 0 }
      : { r: 255, g: 255, b: 255, alpha: 1 },
  };
  let pipeline = sharp(workingBuffer).resize(width, height, resizeOpts);

  // Brightness: slider -100..+100 maps to Sharp's multiplier (0 -> unchanged).
  if (brightness !== 0) {
    pipeline = pipeline.modulate({ brightness: 1 + brightness / 100 });
  }

  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });

  const encode = (quality) =>
    sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .webp({ quality, effort: 4, smartSubsample: true })
      .withMetadata({
        exif: {
          IFD0: {
            Copyright: '© 2026 Arman Zohrabyan',
            Creator: 'Arman Zohrabyan',
          }
        }
      })
      .toBuffer();

  let quality = 95;
  let compressed;

  while (quality >= 10) {
    compressed = await encode(quality);
    if (compressed.length <= targetSizeBytes) {
      return { buffer: compressed, quality, finalSize: compressed.length, width: info.width, height: info.height };
    }
    quality -= 5;
  }

  return { buffer: compressed, quality: 10, finalSize: compressed.length, width: info.width, height: info.height };
};

// Serve static files (client)
app.use(express.static('public'));

// Ensure output directory exists
const OUTPUT_DIR = 'processed_images';
const ensureOutputDir = async () => {
  try {
    await fs.access(OUTPUT_DIR);
  } catch {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  }
};

// Image processing endpoint - support multiple files
app.post('/api/process-image', upload.array('images', 200), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    // Read and validate processing settings from the form
    const width = parseInt(req.body.width, 10) || 600;
    const height = parseInt(req.body.height, 10) || 900;
    const targetSizeKB = parseInt(req.body.maxKB, 10) || 100;
    const fit = ALLOWED_FITS.includes(req.body.fit) ? req.body.fit : 'cover';
    // Brightness: -100..+100, defaults to 0 (no change), clamped to range.
    let brightness = parseInt(req.body.brightness, 10);
    if (Number.isNaN(brightness)) brightness = 0;
    brightness = Math.min(100, Math.max(-100, brightness));
    const removeBg = req.body.removeBg === 'true';

    if (width < 1 || width > 5000 || height < 1 || height > 5000) {
      return res.status(400).json({ error: 'Width and height must be between 1 and 5000' });
    }
    if (targetSizeKB < 1 || targetSizeKB > 10000) {
      return res.status(400).json({ error: 'Max size must be between 1 and 10000 KB' });
    }

    const settings = { width, height, fit, targetSizeKB, brightness, removeBg };
    const results = [];

    for (const file of req.files) {
      try {
        const { buffer, originalname } = file;

        console.log(`Processing ${originalname} -> ${width}x${height} (${fit}, <=${targetSizeKB}KB${removeBg ? ', bg-removed' : ''})...`);
        const compressionResult = await compressToTarget(buffer, settings);
        
        // Sanitize filename and preserve original name
        const sanitizedName = sanitizeFilename(originalname);
        const nameWithoutExt = sanitizedName.replace(/\.[^/.]+$/, "");
        const processedFilename = `${nameWithoutExt}.webp`;
        const outputPath = path.join(OUTPUT_DIR, processedFilename);
        
        // Save the compressed image
        await fs.writeFile(outputPath, compressionResult.buffer);
        
        // Get file stats
        const stats = await fs.stat(outputPath);

        results.push({
          success: true,
          originalName: originalname,
          processedFilename,
          size: stats.size,
          sizeKB: Math.round(stats.size / 1024),
          quality: compressionResult.quality,
          dimensions: `${compressionResult.width}x${compressionResult.height}`,
          format: 'WebP',
          targetSizeKB,
          downloadUrl: `/download/${processedFilename}`
        });

        console.log(`✅ ${originalname} -> ${processedFilename} (${Math.round(stats.size/1024)}KB at ${compressionResult.quality}% quality)`);
        
      } catch (fileError) {
        console.error(`Error processing ${file.originalname}:`, fileError);
        results.push({
          success: false,
          originalName: file.originalname,
          error: fileError.message
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: successCount > 0,
      message: `Processed ${successCount} of ${req.files.length} images successfully`,
      totalFiles: req.files.length,
      successCount,
      results
    });

  } catch (error) {
    console.error('Image processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process images',
      details: error.message 
    });
  }
});

// Download processed image
app.get('/download/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(OUTPUT_DIR, filename);
    
    // Check if file exists
    await fs.access(filePath);
    
    res.download(filePath, `resized_${filename}`);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

// Get image info endpoint (optional)
app.get('/api/image-info/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(OUTPUT_DIR, filename);
    
    const metadata = await sharp(filePath).metadata();
    res.json({
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: metadata.size
    });
  } catch (error) {
    res.status(404).json({ error: 'File not found or invalid image' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${error.message}` });
  }
  res.status(500).json({ error: error.message });
});

// Start server
const startServer = async () => {
  await ensureOutputDir();
  app.listen(PORT, () => {
    console.log(`🚀 Image processing server running on http://localhost:${PORT}`);
    console.log(`📁 Processed images will be saved to: ${OUTPUT_DIR}`);
  });
};

startServer().catch(console.error);
