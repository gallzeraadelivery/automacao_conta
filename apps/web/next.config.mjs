/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@uber-automation/shared"],
  // Gera um bundle de servidor autocontido (.next/standalone) com apenas os
  // node_modules realmente usados - permite uma imagem Docker final bem
  // menor, sem precisar copiar o node_modules inteiro do monorepo.
  output: "standalone",
};

export default nextConfig;
