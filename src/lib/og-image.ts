import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import sharp from 'sharp';

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

const PANEL_HEIGHT = 230;
const PANEL_OPACITY = 0.92;
const LOGO_WIDTH = 240;

// Colours from root.css
const OFFWHITE = 'hsl(17, 22%, 94%)'; // --offwhite
const BLACK = 'hsl(17, 5%, 7%)'; // --black
const GREEN_MID = 'hsl(106, 90%, 27%)'; // --green-mid

// The first third of the --wavy-line-top clip-path in root.css, converted to an SVG path:
// x stretched to span the full 1200px width, y doubled so the wave reads at thumbnail size
const WAVE_PATH =
	'M0 21 Q96.1 40 144.1 30 Q192.2 20 239.9 10 Q287.9 0 335.9 9 Q384 18 432 23 Q480.1 28 528.1 15 Q576.2 2 624.2 3 Q671.9 4 719.9 13 Q768 22 816 14 Q864.1 6 912.1 6 Q960.1 6 1008.2 19 Q1056.2 32 1103.9 31 Q1152 30 1200 22';
const WAVE_HEIGHT = 40;

const root = (...segments: string[]) => path.join(process.cwd(), ...segments);

const overlayHeight = WAVE_HEIGHT + PANEL_HEIGHT;
const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_IMAGE_WIDTH}" height="${overlayHeight}" viewBox="0 0 ${OG_IMAGE_WIDTH} ${overlayHeight}"><path d="${WAVE_PATH} V${overlayHeight} H0 Z" fill="${OFFWHITE}" fill-opacity="${PANEL_OPACITY}"/></svg>`;
const overlayDataUri = `data:image/svg+xml,${encodeURIComponent(overlaySvg)}`;

const font = (file: string) => fs.readFileSync(root('node_modules/@fontsource/lexend/files', file));
const fonts = [
	{
		name: 'Lexend',
		weight: 600 as const,
		style: 'normal' as const,
		data: font('lexend-latin-600-normal.woff'),
	},
	{
		name: 'Lexend',
		weight: 600 as const,
		style: 'normal' as const,
		data: font('lexend-latin-ext-600-normal.woff'),
	},
	{
		name: 'Lexend',
		weight: 700 as const,
		style: 'normal' as const,
		data: font('lexend-latin-700-normal.woff'),
	},
	{
		name: 'Lexend',
		weight: 700 as const,
		style: 'normal' as const,
		data: font('lexend-latin-ext-700-normal.woff'),
	},
];

const logoFile = root('src/assets/logo.png');
const logoMeta = await sharp(logoFile).metadata();
const logoHeight = Math.round((LOGO_WIDTH * logoMeta.height!) / logoMeta.width!);
const logoDataUri = `data:image/png;base64,${fs.readFileSync(logoFile).toString('base64')}`;
const fallbackPhoto = root('src/assets/opengraph-image.png');

function el(
	type: string,
	style: Record<string, unknown>,
	children?: unknown,
	extra?: Record<string, unknown>,
) {
	return { type, props: { style, ...extra, children } };
}

function titleFontSize(title: string): number {
	if (title.length <= 45) return 58;
	if (title.length <= 75) return 48;
	return 42;
}

export interface OgImageOptions {
	title: string;
	kicker?: string;
	photoPath?: string;
}

export async function renderOgImage({ title, kicker, photoPath }: OgImageOptions): Promise<Buffer> {
	const photoFile = photoPath && fs.existsSync(photoPath) ? photoPath : fallbackPhoto;
	const photo = await sharp(photoFile)
		.rotate()
		.resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, { fit: 'cover' })
		.jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
		.toBuffer();
	const photoDataUri = `data:image/jpeg;base64,${photo.toString('base64')}`;

	const tree = el(
		'div',
		{
			width: OG_IMAGE_WIDTH,
			height: OG_IMAGE_HEIGHT,
			display: 'flex',
			flexDirection: 'column',
			backgroundColor: OFFWHITE,
			fontFamily: 'Lexend',
		},
		[
			el('img', { position: 'absolute', top: 0, left: 0 }, undefined, {
				src: photoDataUri,
				width: OG_IMAGE_WIDTH,
				height: OG_IMAGE_HEIGHT,
			}),
			el('img', { position: 'absolute', bottom: 0, left: 0 }, undefined, {
				src: overlayDataUri,
				width: OG_IMAGE_WIDTH,
				height: overlayHeight,
			}),
			el(
				'div',
				{
					position: 'absolute',
					bottom: 0,
					left: 0,
					width: OG_IMAGE_WIDTH,
					height: PANEL_HEIGHT,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: '10px 56px 32px 56px',
				},
				[
					el(
						'div',
						{
							display: 'flex',
							flexDirection: 'column',
							flexGrow: 1,
							paddingRight: 48,
							maxWidth: 880,
						},
						[
							kicker
								? el(
										'div',
										{
											fontSize: 24,
											fontWeight: 600,
											color: GREEN_MID,
											textTransform: 'uppercase',
											letterSpacing: 3,
											marginBottom: 12,
										},
										kicker,
									)
								: null,
							el(
								'div',
								{
									fontSize: titleFontSize(title),
									fontWeight: 700,
									color: BLACK,
									lineHeight: 1.15,
									lineClamp: 3,
								},
								title,
							),
						].filter(Boolean),
					),
					el('img', { flexShrink: 0 }, undefined, {
						src: logoDataUri,
						width: LOGO_WIDTH,
						height: logoHeight,
					}),
				],
			),
		],
	);

	const svg = await satori(tree as never, {
		width: OG_IMAGE_WIDTH,
		height: OG_IMAGE_HEIGHT,
		fonts,
	});
	return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
}
