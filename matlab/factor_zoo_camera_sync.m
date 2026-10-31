function factor_zoo_camera_sync
% FACTOR_ZOO_CAMERA_SYNC Publish a MATLAB camera angle for the local web plot.
% Run from the repository root after starting a local static HTTP server.

projectRoot = fileparts(fileparts(mfilename('fullpath')));
dataPath = fullfile(projectRoot, 'data', 'demo-universe.json');
viewPath = fullfile(projectRoot, 'data', 'factor-zoo-view.json');
schemaVersion = 'portfolio-factor-zoo.v1';

fig = uifigure('Name', 'Factor Zoo camera · MATLAB', ...
    'Position', [240, 240, 560, 230]);
layout = uigridlayout(fig, [6, 2]);
layout.RowHeight = {28, 24, 48, 24, 48, 32};
layout.ColumnWidth = {'1x', '1x'};
layout.Padding = [18, 14, 18, 14];
layout.RowSpacing = 7;
layout.ColumnSpacing = 14;

heading = uilabel(layout, 'Text', 'Factor Zoo · camera angle', ...
    'FontWeight', 'bold', 'FontSize', 15);
heading.Layout.Row = 1;
heading.Layout.Column = [1, 2];

azimuth = uislider(layout, 'Limits', [-180, 180], 'Value', -37.5, ...
    'MajorTicks', [-180, -90, 0, 90, 180]);
azimuth.Layout.Row = 3;
azimuth.Layout.Column = [1, 2];
azimuthLabel = uilabel(layout, 'Text', 'Azimuth: -37.5°');
azimuthLabel.Layout.Row = 2;
azimuthLabel.Layout.Column = [1, 2];

elevation = uislider(layout, 'Limits', [-20, 75], 'Value', 28, ...
    'MajorTicks', [-20, 0, 25, 50, 75]);
elevation.Layout.Row = 5;
elevation.Layout.Column = [1, 2];
elevationLabel = uilabel(layout, 'Text', 'Elevation: 28.0°');
elevationLabel.Layout.Row = 4;
elevationLabel.Layout.Column = [1, 2];

status = uilabel(layout, 'Text', 'Waiting for the local page…', ...
    'FontColor', [0.55, 0.62, 0.70]);
status.Layout.Row = 6;
status.Layout.Column = 1;
resetButton = uibutton(layout, 'Text', 'Reset camera', ...
    'ButtonPushedFcn', @resetCamera);
resetButton.Layout.Row = 6;
resetButton.Layout.Column = 2;

azimuth.ValueChangingFcn = @azimuthChanging;
azimuth.ValueChangedFcn = @azimuthChanged;
elevation.ValueChangingFcn = @elevationChanging;
elevation.ValueChangedFcn = @elevationChanged;
publishView();

    function azimuthChanging(~, event)
        azimuthLabel.Text = sprintf('Azimuth: %.1f°', event.Value);
        publishView(event.Value, elevation.Value);
    end

    function azimuthChanged(source, ~)
        azimuthLabel.Text = sprintf('Azimuth: %.1f°', source.Value);
        publishView();
    end

    function elevationChanging(~, event)
        elevationLabel.Text = sprintf('Elevation: %.1f°', event.Value);
        publishView(azimuth.Value, event.Value);
    end

    function elevationChanged(source, ~)
        elevationLabel.Text = sprintf('Elevation: %.1f°', source.Value);
        publishView();
    end

    function resetCamera(~, ~)
        azimuth.Value = -37.5;
        elevation.Value = 28;
        azimuthLabel.Text = 'Azimuth: -37.5°';
        elevationLabel.Text = 'Elevation: 28.0°';
        publishView();
    end

    function publishView(azimuthValue, elevationValue)
        try
            if nargin < 1 || isempty(azimuthValue)
                azimuthValue = azimuth.Value;
            end
            if nargin < 2 || isempty(elevationValue)
                elevationValue = elevation.Value;
            end
            if ~isfile(dataPath)
                error('Factor Zoo data dump not found: %s', dataPath);
            end
            data = jsondecode(fileread(dataPath));
            if ~isfield(data, 'schema_version') || ...
                    ~strcmp(data.schema_version, schemaVersion) || ...
                    ~isfield(data, 'artifact_fingerprint')
                error('The Factor Zoo data schema or fingerprint is invalid.');
            end

            view = struct( ...
                'schema_version', schemaVersion, ...
                'status', 'SYNCED', ...
                'azimuth', azimuthValue, ...
                'elevation', elevationValue, ...
                'updated_at_utc', char(datetime('now', 'TimeZone', 'UTC', ...
                    'Format', 'yyyy-MM-dd''T''HH:mm:ss.SSS''Z''')), ...
                'artifact_fingerprint', data.artifact_fingerprint);

            writeJsonAtomically(viewPath, jsonencode(view));
            status.Text = sprintf('Published · %s UTC', ...
                char(datetime('now', 'TimeZone', 'UTC', 'Format', 'HH:mm:ss')));
            status.FontColor = [0.20, 0.73, 0.62];
        catch exception
            status.Text = ['Not synced · ' exception.message];
            status.FontColor = [0.88, 0.40, 0.39];
        end
    end
end

function writeJsonAtomically(targetPath, contents)
folder = fileparts(targetPath);
if ~isfolder(folder)
    mkdir(folder);
end
temporaryPath = [tempname(folder), '.json'];
file = fopen(temporaryPath, 'w');
if file < 0
    error('Unable to create a temporary camera-state file.');
end
cleanup = onCleanup(@cleanupTemporary);
count = fwrite(file, contents, 'char');
if count ~= numel(contents)
    error('Unable to write the complete camera-state JSON.');
end
fclose(file);
file = -1;
[ok, message] = movefile(temporaryPath, targetPath, 'f');
if ~ok
    error('Unable to publish camera state: %s', message);
end
clear cleanup;
    function cleanupTemporary()
        if file >= 0
            fclose(file);
            file = -1;
        end
        if isfile(temporaryPath)
            delete(temporaryPath);
        end
    end
end
