import {
  ImagePool
} from "@squoosh/lib";
import fs, {
  readFile
} from 'fs/promises';
import express from 'express';
import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';
import {
  fileURLToPath
} from 'url';

dotenv.config();
const __filename = fileURLToPath(
  import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/public', express.static(path.join(__dirname, 'public'))) //agar gambar bisa diakses

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname) // Sesuai nama file yg dikirm
    // cb(null, Date.now() + path.extname(file.originalname)) // Nama file unik
  }
})

const upload = multer({
  storage: storage
});

const app = express()
const PORT = process.env.PORT
const BASE_URL = `${process.env.BASE_URL}:${PORT}/`

app.post('/compress', upload.single('image'), function (req, res, next) {

  compress(req.file.destination + req.file.originalname, Number(req.body.quality), req.body.convertTo, JSON.parse(req.body.resize)).then(e => {
    if (e.code > 200) {
      res.send(e)
    }

    const filename = req.file.originalname.replace(path.extname(req.file.originalname), '.' + e.extension) // nama file sesuai nama asli
    res.send({
      code: 200,
      fileSizeBefore: req.file.size,
      fileSizeAfter: e.size,
      quality: e.optionsUsed.quality,
      compressed: 100 - Math.round(e.size / req.file.size * 100),
      url: BASE_URL + req.file.destination.replace('uploads', 'compressed') + filename,
      filename: filename,
      extension: e.extension
    })
  })
})

/**
 * Fungsi untuk mengkompres gambar
 * 
 * @param {string} path  Path gambar yang akan di compress.
 * @param {int} quality Kualitas gambar. dari 1-100. Nilai defaultnya adalah 100
 * @param {string} convertTo Ubah gambar ke format jpg|png|mozjpeg|webp.
 * @param {array} resize [width,height]. Jika salah satu diisi, maka gambar akan diubah ukurannya ke ukuran yg ditentukan dengan menjaga aspek rasio. Jika kosong, berarti tidak akan di resize.
 * @returns {object}
 */
async function compress(path, quality = 100, convertTo = null, resize = null) {

  if (!readFile(path)) return await {
    code: 400,
    Message: "Path tidak ditemukan"
  }
  if (convertTo == null) return await {
    code: 401,
    Message: "convertTo tidak boleh kosong"
  }

  const imagePool = new ImagePool();
  const image = imagePool.ingestImage(path);

  // bagian preprocess
  if (resize != null) {
    const preprocessOptions = {
      resize: {}
    };
    if (resize[0] != '' && resize[1] != '') { // jika width dan height diisi
      preprocessOptions.resize.width = Number(resize[0]);
      preprocessOptions.resize.height = Number(resize[1]);
    }
    if (resize[0] != '') { // jika width diisi
      preprocessOptions.resize.width = Number(resize[0]);
    }
    if (resize[1] != '') { // jika height diisi
      preprocessOptions.resize.height = Number(resize[1]);
    }
    await image.preprocess(preprocessOptions);
  }

  //bagian compress
  if (convertTo.search(/jpg|png|mozjpeg|webp/) < 0) return await {
    code: 402,
    Message: "Format tidak tersedia"
  }

  await image.encode({
    [convertTo]: {
      quality: quality == '' ? 100 : quality,
    },
  });

  const splitPath = path.split('/')
  const filename = splitPath[splitPath.length - 1].split('.')[0]
  const {
    extension,
    binary
  } = await image.encodedWith[convertTo];

  await fs.writeFile(`./public/compressed/${filename}.${extension}`, binary, {
    flag: "w"
  }, );

  await imagePool.close();
  return await image.encodedWith[convertTo];
}

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`)
})