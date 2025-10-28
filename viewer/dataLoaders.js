import * as THREE from 'three';
import { fromUrl } from 'https://esm.sh/geotiff@2.1.3';

export async function loadTiff(url) {
  const tiff = await fromUrl(url);
  const image = await tiff.getImage();
  return {
    image,
    width: image.getWidth(),
    height: image.getHeight(),
    bands: image.getSamplesPerPixel(),
  };
}

export async function loadWavelengthsCSV(url) {
  const text = await fetch(url).then((response) => response.text());
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const parts = line.split(',');
      return parseFloat(parts[1]);
    })
    .filter((value) => Number.isFinite(value));
}

export async function loadCieTexture(url, isWebGL2) {
  const text = await fetch(url).then((response) => response.text());
  const rows = text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [wavelength, x, y, z] = line.split(',');
      return {
        wavelength: parseFloat(wavelength),
        X: parseFloat(x),
        Y: parseFloat(y),
        Z: parseFloat(z),
      };
    })
    .filter((row) => row.wavelength >= 390 && row.wavelength <= 710);

  const width = rows.length;
  const array = new Float32Array(width * 3);
  rows.forEach((row, index) => {
    const offset = index * 3;
    array[offset + 0] = row.X;
    array[offset + 1] = row.Y;
    array[offset + 2] = row.Z;
  });

  const texture = new THREE.DataTexture(array, width, 1, THREE.RGBFormat, THREE.FloatType);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  if (isWebGL2) {
    texture.internalFormat = 'RGB32F';
  }

  return {
    texture,
    wavelengths: rows.map((row) => row.wavelength),
  };
}
