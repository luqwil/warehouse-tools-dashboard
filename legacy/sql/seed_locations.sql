DELETE FROM dbo.Locations;
GO

DECLARE @MaxLevel INT = 5;

;WITH RowsCTE AS (
    SELECT 'A' AS row_label
    UNION ALL SELECT 'B'
    UNION ALL SELECT 'C'
    UNION ALL SELECT 'D'
),
BaysCTE AS (
    SELECT 1 AS bay_number
    UNION ALL SELECT 2
    UNION ALL SELECT 3
    UNION ALL SELECT 4
    UNION ALL SELECT 5
),
SidesCTE AS (
    SELECT 'F' AS side
    UNION ALL SELECT 'B'
),
LevelsCTE AS (
    SELECT 1 AS level_number
    UNION ALL SELECT 2
    UNION ALL SELECT 3
    UNION ALL SELECT 4
    UNION ALL SELECT 5
)
INSERT INTO dbo.Locations (row_label, bay_number, side, level_number, description, capacity)
SELECT
    r.row_label,
    b.bay_number,
    s.side,
    lv.level_number,
    CONCAT('Row ', r.row_label, ', Bay ', b.bay_number, ', ',
           CASE WHEN s.side = 'F' THEN 'Front' ELSE 'Back' END,
           ', Level ', lv.level_number),
    200
FROM RowsCTE r
CROSS JOIN BaysCTE b
CROSS JOIN SidesCTE s
CROSS JOIN LevelsCTE lv
WHERE
    (
      b.bay_number BETWEEN 1 AND 4       -- bays 1–4: all rows, both sides
    )
    OR
    (
      b.bay_number = 5                   -- bay 5: ONLY C & D, FRONT only
      AND r.row_label IN ('C','D')
      AND s.side = 'F'
    )
ORDER BY
    r.row_label, b.bay_number, s.side, lv.level_number;
GO

-- quick check
SELECT row_label, bay_number, side, level_number, location_code
FROM dbo.Locations
ORDER BY row_label, bay_number, side, level_number;