-- ============================================================
-- Layer 3  |  demo signed-DC images
-- The Layer 1 seed referenced external demo image URLs that do not
-- resolve, which left broken thumbnails in the site-wise archive.
-- Point demo rows at a self-contained placeholder instead.
-- ============================================================
UPDATE challans
   SET signed_dc_photo_url = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22480%22%20height%3D%22620%22%3E%3Crect%20width%3D%22480%22%20height%3D%22620%22%20fill%3D%22%23f8fafc%22%2F%3E%3Crect%20x%3D%2214%22%20y%3D%2214%22%20width%3D%22452%22%20height%3D%22592%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%2F%3E%3Ctext%20x%3D%22240%22%20y%3D%2280%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2222%22%20fill%3D%22%231e3a8a%22%3EKOOL%20MART%20INDIA%3C%2Ftext%3E%3Ctext%20x%3D%22240%22%20y%3D%22118%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2214%22%20fill%3D%22%23475569%22%3ESIGNED%20DELIVERY%20CHALLAN%20%28DEMO%29%3C%2Ftext%3E%3Ctext%20x%3D%22240%22%20y%3D%22170%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-size%3D%2212%22%20fill%3D%22%2364748b%22%3ESignature%20and%20stamp%20on%20file%3C%2Ftext%3E%3C%2Fsvg%3E'
 WHERE is_demo = true
   AND signed_dc_photo_url LIKE 'https://images.koolmart.in/demo/%';
