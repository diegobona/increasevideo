# Rebuild the raster/ICO exports from the SVG master with Windows' built-in renderer.
# No downloaded fonts, native binaries, or additional package dependencies.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$brandRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public/brand'))
$publicRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public'))
$docsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../docs/brand'))
[IO.Directory]::CreateDirectory($docsRoot) | Out-Null
$markSource = Get-Content (Join-Path $brandRoot 'logo-mark.svg') -Raw
[xml]$mark = $markSource

function Brush([string]$hex) { return [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($hex)) }
function RoundedRect($graphics, $brush, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $path = [Drawing.Drawing2D.GraphicsPath]::new()
  $d = 2 * $r
  $path.AddArc($x,$y,$d,$d,180,90)
  $path.AddArc(($x+$w-$d),$y,$d,$d,270,90)
  $path.AddArc(($x+$w-$d),($y+$h-$d),$d,$d,0,90)
  $path.AddArc($x,($y+$h-$d),$d,$d,90,90)
  $path.CloseFigure()
  $graphics.FillPath($brush,$path)
  $path.Dispose()
}
function Draw-Mark($graphics, [single]$x, [single]$y, [single]$size) {
  $state = $graphics.Save()
  $graphics.TranslateTransform($x,$y)
  $graphics.ScaleTransform(($size/64),($size/64))
  foreach ($rect in $mark.svg.rect) {
    $brush = Brush $rect.fill
    RoundedRect $graphics $brush ([single]$rect.x) ([single]$rect.y) ([single]$rect.width) ([single]$rect.height) ([single]$rect.rx)
    $brush.Dispose()
  }
  # The SVG master uses straight M/L/H/V commands for a pixel-sharp silhouette.
  $tokens = [regex]::Matches($mark.svg.path.d, '[MLHVZ]|-?\d+(?:\.\d+)?') | ForEach-Object Value
  $points = [Collections.Generic.List[Drawing.PointF]]::new()
  [single]$px=0; [single]$py=0
  for ($i=0; $i -lt $tokens.Count; $i++) {
    switch ($tokens[$i]) {
      'M' { $px=[single]$tokens[++$i]; $py=[single]$tokens[++$i] }
      'L' { $px=[single]$tokens[++$i]; $py=[single]$tokens[++$i] }
      'H' { $px=[single]$tokens[++$i] }
      'V' { $py=[single]$tokens[++$i] }
      'Z' { continue }
    }
    if ($tokens[$i] -ne 'Z') { $points.Add([Drawing.PointF]::new($px,$py)) }
  }
  $brush = Brush $mark.svg.path.fill
  $graphics.FillPolygon($brush,$points.ToArray())
  $brush.Dispose()
  $graphics.Restore($state)
}
function Canvas([int]$w,[int]$h) {
  $bitmap=[Drawing.Bitmap]::new($w,$h,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @{ Bitmap=$bitmap; Graphics=$graphics }
}
function Save-Canvas($canvas,[string]$file) {
  $canvas.Bitmap.Save($file,[Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose()
}
function Text($graphics,[string]$value,[single]$size,[single]$x,[single]$y,[string]$color,[bool]$bold=$false) {
  $style=if($bold){[Drawing.FontStyle]::Bold}else{[Drawing.FontStyle]::Regular}
  $font=[Drawing.Font]::new('Arial',$size,$style,[Drawing.GraphicsUnit]::Pixel)
  $brush=Brush $color
  $graphics.DrawString($value,$font,$brush,$x,$y)
  $font.Dispose();$brush.Dispose()
}

Copy-Item -LiteralPath (Join-Path $brandRoot 'logo-mark.svg') -Destination (Join-Path $publicRoot 'favicon.svg')
$iconBytes=@{}
foreach($size in @(16,32,48,180,192,512)) {
  $canvas=Canvas ($size*4) ($size*4)
  Draw-Mark $canvas.Graphics 0 0 ($size*4)
  $small=Canvas $size $size
  if($size -eq 180){$small.Graphics.Clear([Drawing.ColorTranslator]::FromHtml('#273528'))}
  $small.Graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $small.Graphics.DrawImage($canvas.Bitmap,0,0,$size,$size)
  $canvas.Graphics.Dispose();$canvas.Bitmap.Dispose()
  $file=if($size -eq 180){Join-Path $publicRoot 'apple-touch-icon.png'}else{Join-Path $brandRoot "icon-$size.png"}
  Save-Canvas $small $file
  if($size -in @(16,32,48)) { $iconBytes[$size]=[IO.File]::ReadAllBytes($file) }
}
$stream=[IO.MemoryStream]::new()
$writer=[IO.BinaryWriter]::new($stream)
$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]3)
$offset=6+16*3
foreach($size in @(16,32,48)) {
  $bytes=$iconBytes[$size]
  $writer.Write([byte]$size);$writer.Write([byte]$size);$writer.Write([byte]0);$writer.Write([byte]0)
  $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$bytes.Length);$writer.Write([uint32]$offset)
  $offset+=$bytes.Length
}
foreach($size in @(16,32,48)){$writer.Write([byte[]]$iconBytes[$size])}
[IO.File]::WriteAllBytes((Join-Path $publicRoot 'favicon.ico'),$stream.ToArray())
$writer.Dispose();$stream.Dispose()

# Outline the wordmark so standalone SVGs render without any font dependency.
$word=[Drawing.Drawing2D.GraphicsPath]::new()
$family=[Drawing.FontFamily]::new('Arial')
$word.AddString('increase',$family,[int][Drawing.FontStyle]::Bold,55,[Drawing.PointF]::new(108,17),[Drawing.StringFormat]::GenericTypographic)
$svgPath=[Text.StringBuilder]::new()
$pts=$word.PathPoints;$types=$word.PathTypes
$culture=[Globalization.CultureInfo]::InvariantCulture
function XY($point){return $point.X.ToString('0.###',$culture)+','+$point.Y.ToString('0.###',$culture)}
for($i=0;$i -lt $pts.Length;$i++){
  $kind=$types[$i] -band 7
  if($kind -eq 0){[void]$svgPath.Append('M'+(XY $pts[$i]))}
  elseif($kind -eq 1){[void]$svgPath.Append('L'+(XY $pts[$i]))}
  elseif($kind -eq 3){[void]$svgPath.Append('C'+(XY $pts[$i])+' '+(XY $pts[$i+1])+' '+(XY $pts[$i+2]));$i+=2}
  if($types[$i] -band 128){[void]$svgPath.Append('Z')}
}
$dotX=$word.GetBounds().Right+5
$markBody=[regex]::Replace($markSource,'(?s)^<svg[^>]*>|</svg>\s*$','')
foreach($variant in @('light','dark')){
  $ink=if($variant -eq 'light'){'#273528'}else{'#F5F5E9'}
  $svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 96" role="img" aria-labelledby="brand-title"><title id="brand-title">Increase Video Quality</title><g transform="translate(8 8) scale(1.25)">'+$markBody+'</g><path d="'+$svgPath.ToString()+'" fill="'+$ink+'"/><circle cx="'+$dotX.ToString('0.###',$culture)+'" cy="66" r="4.8" fill="#91AA64"/></svg>'
  $name=if($variant -eq 'light'){'logo.svg'}else{'logo-on-dark.svg'}
  [IO.File]::WriteAllText((Join-Path $brandRoot $name),$svg,[Text.UTF8Encoding]::new($false))
}

$board=Canvas 1440 1000
$g=$board.Graphics;$g.Clear([Drawing.ColorTranslator]::FromHtml('#FAF9F6'))
Text $g 'INCREASE VIDEO QUALITY' 17 76 54 '#637255' $true
Text $g 'A little less noise. A lot more clarity.' 18 76 84 '#72756C'
Draw-Mark $g 160 225 180
Text $g 'increase' 112 365 232 '#273528' $true
Text $g '.' 112 816 232 '#91AA64' $true
Text $g 'VIDEO QUALITY' 21 373 361 '#637255'
$darkBrush=Brush '#1B281F';RoundedRect $g $darkBrush 76 510 760 228 22;$darkBrush.Dispose()
Draw-Mark $g 120 578 88
Text $g 'increase' 56 226 578 '#F5F5E9' $true
Text $g '.' 56 452 578 '#91AA64' $true
Text $g 'Dark background' 14 120 686 '#A7B59C'
Text $g 'MADE FOR SMALL SCREENS' 14 900 522 '#637255' $true
Draw-Mark $g 902 578 64
Draw-Mark $g 1006 594 32
Draw-Mark $g 1080 602 16
Text $g '64 px' 13 913 660 '#72756C'
Text $g '32 px' 13 1005 660 '#72756C'
Text $g '16 px' 13 1069 660 '#72756C'
Text $g 'Pixel fragments become a crisp play symbol.' 22 76 824 '#273528'
Text $g 'An identity for clearer footage, built in SVG and ready for every tab.' 17 76 866 '#72756C'
Save-Canvas $board (Join-Path $docsRoot 'logo-preview.png')
$word.Dispose();$family.Dispose()
Write-Output 'Generated: SVG logo variants, SVG/ICO favicon, PNG icons, Apple touch icon, brand preview.'
