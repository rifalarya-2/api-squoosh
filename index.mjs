import {
  ImagePool
} from "@squoosh/lib";
import fs from 'fs/promises';
import express from 'express';
import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';
import {
  fileURLToPath
} from 'url';

dotenv.config();
const app = express()
const PORT = process.env.NODE_ENV == 'development' ? 3000 : 80 // 80=http, 443=https
const BASE_URL = `${process.env.BASE_URL}:${PORT}/`
const SUPPORTED_TYPE = /jpg|jpeg|png|webp|jxl/i

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
app.use('/public', express.static(path.join(__dirname, 'public'))) //agar gambar bisa diakses

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/')
  },
  filename: function (req, file, cb) {
    // cb(null, file.originalname) // Sesuai nama file yg dikirm
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '_' + file.originalname.replaceAll(' ', '_')) // Nama file unik
  }
})

const upload = multer({
  storage: storage
})

app.post('/compress', upload.single('image'), function (req, res, next) {

  //validaton
  if (req.file == undefined) {
    return res.status(400).send({
      code: 400,
      message: "Image harus diisi"
    })
  }
  if (req.file.originalname.search(SUPPORTED_TYPE) < 0) {
    hapusFile('./public/uploads/' + req.file.filename)
    return res.status(400).send({
      code: 400,
      message: "Format file tidak didukung"
    })
  }
  if (req.body.convertTo == undefined) {
    req.body.convertTo = path.extname(req.file.originalname).replace('.', '') // jika convertTo tidak di isi, maka akan di kompres sesuai dengan ekstensi filenya
  }
  if (req.body.convertTo.search(SUPPORTED_TYPE) < 0) {
    hapusFile('./public/uploads/' + req.file.filename)
    return res.status(400).send({
      code: 400,
      message: "Format tidak tersedia"
    })
  }
  fs.open('./public/uploads/' + req.file.filename, 'r').catch(e => {
    return res.status(503).send({
      code: 503,
      message: "Gambar gagal dikompres, silahkan coba lagi nanti atau gunakan gambar yang lain" // "gagal di kompres" sebenarnya, gambar yg di kirim oleh user tidak tersimpan di server
    })
  })

  const resize = {
    width: req.body.width == undefined ? undefined : Number(req.body.width),
    height: req.body.height == undefined ? undefined : Number(req.body.height)
  }

  try {
    compress(req.file.destination + req.file.filename, Number(req.body.quality), req.body.convertTo, resize).then(e => {
      hapusFile('./public/uploads/' + req.file.filename) // ketika berhasil, hapus file yang ada di folder uploads

      if (e.code > 200) {
        return res.status(e.code).send(e)
      }

      const filename = req.file.filename.replace(path.extname(req.file.originalname), '.' + e.extension)

      return res.status(200).send({
        code: 200,
        fileSizeBefore: req.file.size,
        fileSizeAfter: e.size,
        quality: e.optionsUsed.quality,
        compressed: Math.floor(100 - Number.parseFloat(e.size / req.file.size * 100).toFixed(1)),
        url: BASE_URL + req.file.destination.replace('uploads', 'compressed') + filename.replaceAll(' ', '_')
      })
    })
  } catch (error) {
    hapusFile('./public/uploads/' + req.file.filename)
    return res.send(res.status(500).json((error)))
  }

  //handling ketika kompres hang
  const apiTimeout = 35*1000
  req.setTimeout(apiTimeout, () => {
    hapusFile('./public/uploads/' + req.file.filename) // ketika gagal, hapus file yang ada di folder upload
    return res.status(408).send({
      code: 408,
      message: 'Tidak bisa meng-kompres gambar ini. silahkan coba lagi nanti atau coba dengan gambar yang lain'
    })
  })
  // timeout untuk response
  res.setTimeout(apiTimeout, () => {
    hapusFile('./public/uploads/' + req.file.filename) // ketika gagal, hapus file yang ada di folder upload
    return res.status(503).send({
      code: 503,
      message: 'Tidak bisa meng-kompres gambar ini. silahkan coba lagi nanti atau coba dengan gambar yang lain'
    })
  })

})

/**
 * Fungsi untuk mengkompres gambar
 * 
 * @param {string} path  Path gambar yang akan di compress.
 * @param {int} quality Kualitas gambar. dari 1-100. Nilai defaultnya adalah 100
 * @param {string} convertTo Ubah gambar ke format jpg|jpeg|png|webp|jxl.
 * @param {object} resize Jika salah satu diisi, maka gambar akan diubah ukurannya ke ukuran yg ditentukan dengan menjaga aspek rasio. Jika kosong, berarti tidak akan di resize.
 * @returns {object}
 */
async function compress(path, quality, convertTo, resize) {

  const overwriteQuality = isNaN(quality) ? 100 : quality //karena Number(undefined) = NaN
  
  //overwrite format yang dimasukan sesuai dengan nama encoder 
  switch (convertTo.toLowerCase()) {
    case 'png':
      convertTo = 'oxipng'
      break;

    case 'jpg':
      convertTo = 'mozjpeg'
      break;

    case 'jpeg':
      convertTo = 'mozjpeg'
      break;

    default:
      break;
  }

  const imagePool = new ImagePool();
  const image = imagePool.ingestImage(path);

  try {
    // bagian preprocess
    const preprocessOptions = {};
    if (resize.width != undefined || resize.height != undefined) { // jika width dan height diisi
      preprocessOptions.resize = {}
    }
    if (resize.width != undefined) { // jika width diisi
      preprocessOptions.resize.width = Number(resize.width);
    }
    if (resize.height != undefined) { // jika height diisi
      preprocessOptions.resize.height = Number(resize.height);
    }
    if (preprocessOptions.hasOwnProperty('resize')) {
      await image.preprocess(preprocessOptions)
    }

    //bagian compress
    await image.encode({
      [convertTo]: {
        quality: overwriteQuality
      },
    })

    const {
      extension,
      binary
    } = await image.encodedWith[convertTo]

    const splitPath = path.split('/')
    const filename = splitPath[splitPath.length - 1].split('.')[0]
    await fs.writeFile(`./public/compressed/${filename}.${extension}`, binary, {
      flag: "w"
    }, )

    await imagePool.close();
    return await image.encodedWith[convertTo]

  } catch (error) {
    hapusFile(path)
    return await {
      code: 503,
      message: "Gambar gagal dikompress, silahkan coba lagi nanti" 
    }
  }
}

async function hapusFile(path) {
  await fs.unlink(path, (err) => {
    if (err) {
      console.error(err)
    }
  })
}

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`)
})