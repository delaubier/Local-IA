Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path $PSScriptRoot '../public/icons'
New-Item -ItemType Directory -Force -Path $iconRoot | Out-Null
foreach ($iconSize in @(16, 32, 48, 128)) {
  $bitmap = New-Object System.Drawing.Bitmap($iconSize, $iconSize)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.ScaleTransform($iconSize / 32.0, $iconSize / 32.0)
  $background = New-Object System.Drawing.Drawing2D.GraphicsPath
  $background.AddArc(0, 0, 14, 14, 180, 90)
  $background.AddArc(18, 0, 14, 14, 270, 90)
  $background.AddArc(18, 18, 14, 14, 0, 90)
  $background.AddArc(0, 18, 14, 14, 90, 90)
  $background.CloseFigure()
  $darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#181a19'))
  $accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#a9c9b7'))
  $graphics.FillPath($darkBrush, $background)
  $graphics.TranslateTransform(2, 2)
  $mark = New-Object System.Drawing.Drawing2D.GraphicsPath
  $mark.AddLine(6, 7, 6, 17)
  $mark.AddBezier(6, 17, 6, 19.7614, 8.2386, 22, 11, 22)
  $mark.AddLine(11, 22, 21, 22)
  $mark.StartFigure()
  $mark.AddLine(12, 5, 12, 14)
  $mark.AddBezier(12, 14, 12, 15.6569, 13.3431, 17, 15, 17)
  $mark.AddLine(15, 17, 23, 17)
  $pen = New-Object System.Drawing.Pen($accentBrush, 2.5)
  $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawPath($pen, $mark)
  $graphics.FillEllipse($accentBrush, 19.5, 4.5, 5, 5)
  $bitmap.Save((Join-Path $iconRoot "localai-$iconSize.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $mark.Dispose(); $background.Dispose(); $darkBrush.Dispose(); $accentBrush.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
