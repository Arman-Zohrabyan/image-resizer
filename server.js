const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

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

// Function to compress image to under 100KB
const compressToTarget = async (buffer, targetSizeKB = 100) => {
  const targetSizeBytes = targetSizeKB * 1024;
  let quality = 95;
  let compressed;
  
  while (quality > 10) {
    compressed = await sharp(buffer)
      .resize(720, 480, { fit: 'cover' })
      .webp({
        quality: quality,
        effort: 6,
        smartSubsample: true
      })
      .withMetadata({
        exif: {
          IFD0: {
            Copyright: '© 2025 Arman Zohrabyan',
            Creator: 'Arman Zohrabyan',
          }
        }
      })
      .toBuffer();
    
    if (compressed.length <= targetSizeBytes) {
      return { buffer: compressed, quality, finalSize: compressed.length };
    }
    
    quality -= 2; // Reduce quality by 2% each iteration
  }
  
  // If still too large, try with minimal quality
  compressed = await sharp(buffer)
    .resize(720, 480, { 
      fit: 'cover',        // Crop centered, maintain aspect ratio
    })
    .webp({
      quality: 10,
      effort: 6,
      smartSubsample: false
    })
    .withMetadata({})
    .toBuffer();
  
  return { buffer: compressed, quality: 10, finalSize: compressed.length };
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
app.post('/api/process-image', upload.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    const results = [];
    
    for (const file of req.files) {
      try {
        const { buffer, originalname } = file;

        // Compress image to under 50KB
        console.log(`Processing ${originalname}...`);
        const compressionResult = await compressToTarget(buffer, 50);
        
        // Sanitize filename and preserve original name
        const sanitizedName = sanitizeFilename(originalname);
        const nameWithoutExt = sanitizedName.replace(/\.[^/.]+$/, "");
        const processedFilename = `${nameWithoutExt}${compressionResult.quality > 75 ? '' : '_bad'}.webp`;
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
          dimensions: '720x480',
          format: 'WebP',
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
