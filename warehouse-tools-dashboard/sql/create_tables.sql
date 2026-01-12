IF OBJECT_ID('dbo.Items', 'U') IS NOT NULL DROP TABLE dbo.Items;
IF OBJECT_ID('dbo.StockMoves', 'U') IS NOT NULL DROP TABLE dbo.StockMoves;
IF OBJECT_ID('dbo.StockLevels', 'U') IS NOT NULL DROP TABLE dbo.StockLevels;
IF OBJECT_ID('dbo.Locations', 'U') IS NOT NULL DROP TABLE dbo.Locations;
GO

CREATE TABLE dbo.Items (
    item_id      INT IDENTITY(1,1) PRIMARY KEY,
    isbn         NVARCHAR(20) UNIQUE NOT NULL,
    title        NVARCHAR(300) NULL,
    format       NVARCHAR(50) NULL,
    created_at   DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);
GO

CREATE TABLE dbo.Locations (
    location_id    INT IDENTITY(1,1) PRIMARY KEY,

    row_label      NVARCHAR(5) NOT NULL,   -- 'A','B','C','D'
    bay_number     INT NOT NULL,           -- 1..5
    side           CHAR(1) NOT NULL,       -- 'F' or 'B'
    level_number   INT NOT NULL,           -- 1..N

    location_code  AS (
        row_label + '-' +
        RIGHT('00' + CAST(bay_number AS NVARCHAR(2)), 2) + '-' +
        side + '-' +
        CAST(level_number AS NVARCHAR(2))
    ) PERSISTED,

    description    NVARCHAR(200) NULL,
    capacity       INT NOT NULL DEFAULT 200,
    created_at     DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);

CREATE UNIQUE INDEX UX_Locations_Layout
ON dbo.Locations (row_label, bay_number, side, level_number);
GO

CREATE TABLE dbo.StockLevels (
    stock_id     INT IDENTITY(1,1) PRIMARY KEY,
    item_id      INT NOT NULL,
    location_id  INT NOT NULL,
    quantity     INT NOT NULL DEFAULT 0,
    CONSTRAINT UQ_StockLevels_Item_Location UNIQUE (item_id, location_id),
    CONSTRAINT FK_StockLevels_Item FOREIGN KEY (item_id) REFERENCES dbo.Items(item_id),
    CONSTRAINT FK_StockLevels_Location FOREIGN KEY (location_id) REFERENCES dbo.Locations(location_id)
);
GO

CREATE TABLE dbo.StockMoves (
    move_id          INT IDENTITY(1,1) PRIMARY KEY,
    item_id          INT NOT NULL,
    from_location_id INT NULL,
    to_location_id   INT NULL,
    quantity         INT NOT NULL,
    reason           NVARCHAR(50) NOT NULL,   -- 'RECEIVE','MOVE','ADJUST'
    notes            NVARCHAR(255) NULL,
    moved_at         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_StockMoves_Item FOREIGN KEY (item_id) REFERENCES dbo.Items(item_id),
    CONSTRAINT FK_StockMoves_FromLoc FOREIGN KEY (from_location_id) REFERENCES dbo.Locations(location_id),
    CONSTRAINT FK_StockMoves_ToLoc FOREIGN KEY (to_location_id) REFERENCES dbo.Locations(location_id)
);
GO

IF OBJECT_ID('dbo.v_LocationFreeSpace', 'V') IS NOT NULL DROP VIEW dbo.v_LocationFreeSpace;
GO

CREATE VIEW dbo.v_LocationFreeSpace AS
SELECT
    l.location_id,
    l.location_code,
    l.row_label,
    l.bay_number,
    l.side,
    l.level_number,
    l.capacity,
    ISNULL(SUM(s.quantity), 0) AS used,
    l.capacity - ISNULL(SUM(s.quantity), 0) AS free_space
FROM dbo.Locations l
LEFT JOIN dbo.StockLevels s ON l.location_id = s.location_id
GROUP BY
    l.location_id, l.location_code,
    l.row_label, l.bay_number, l.side, l.level_number,
    l.capacity;
GO