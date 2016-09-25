Ext.define("TSIterationAcceptanceReport", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout: { type: 'border' },
    
    items: [
        {xtype:'container',itemId:'selector_box', region: 'north', layout: { type: 'hbox' }},
        {xtype:'container',itemId:'display_box',  region: 'center', layout: { type: 'fit' } }
    ],

    config: {
        defaultSettings: {
            showAllWorkspaces: false,
            projectFields: ['c_EPMSid','c_EPMSID'],
            projectPILevel: 2  // level 0 is bottom
        }
    },    
    
    integrationHeaders : {
        name : "TSIterationAcceptanceReport"
    },
    
    launch: function() {
        var me = this;
        this.setLoading('Loading...');
        this._addSelectors(this.down('#selector_box'));
        
        this._getWorkspaces(this.getSetting('showAllWorkspaces')).then({
            success: this._updateData,
            failure: function(msg) {
                Ext.Msg.alert("Problem initializing", msg);
            },
            scope: this
        }).always(function() { me.setLoading(false); });
    },
    
    _addSelectors: function(container) {
        container.removeAll();
        
        var spacer = container.add({ xtype: 'container', flex: 1});
        
        container.add({
            xtype:'rallybutton',
            itemId:'export_button',
            text: '<span class="icon-export"> </span>',
            disabled: true,
            listeners: {
                scope: this,
                click: this._export
            }
        });
    },
    
    _updateData: function(workspaces) {
        var me = this;
        this.setLoading('Fetching Iteration Data...');
        this.logger.log("Using workspaces: ", workspaces);
        
        Deft.Chain.sequence([
            function() { return me._getAllProjects(workspaces); },
            function() { return me._getArtifactsFromIterationsInWorkspaces(workspaces); }
        ]).then({
            success: function(results) {
                this.logger.log('results:', results);
                var projects = results[0];
                var artifacts = results[1];
                
                var non_archived_artifacts = Ext.Array.filter(artifacts, function(artifact){
                    var feature = artifact.get('Feature');
                    var parent = feature && feature.Parent;
                    if ( !Ext.isEmpty(parent) ) {
                        if ( parent.Parent && parent.Parent.Archived == true ) {
                            return false;
                        }
                    }
                    return true;
                });

                projects = this._getUniqueProjectsFromArray(projects);
                // NOT the Rally project OID, the "project" ID
                projects = this._assignArtifactsToProjects(projects,non_archived_artifacts);
                  
                this._makeGrid(projects);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem loading data', msg);
            },
            scope: this
        }).always(function() { me.setLoading(false); });;

    },
    
    _getAllProjects: function(workspaces) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        var promises = Ext.Array.map(workspaces, function(workspace){
            return function() {
                return me._getProjectsForWorkspace( workspace );
            }
        });
        
        Deft.Chain.sequence(promises,this).then({
            success: function(results) {
                var projects = Ext.Array.flatten(results);
                this.projects = projects
                deferred.resolve(projects);
            },
            failure: function(msg) { 
                deferred.reject(msg);
            },
            scope: this
        });
        
        return deferred.promise;
    },
    
    _getProjectsForWorkspace: function(workspace) {
        var me = this;

        return Deft.Chain.parallel([
            function() { return me._getPossibleProjectsFromRallyProjects(workspace); },
            function() { return me._getPossibleProjectsFromPIs(workspace); }
        ],me);
    },
    
    _getPossibleProjectsFromRallyProjects: function(workspace) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        var project_filters = [
            {property:'Name',operator:'contains', value: '10' },
            {property:'Name',operator:'!contains', value:'Archive'},
            {property:'Parent.Name',operator:'!contains', value:'Archive'}
        ];
        
        var config = {
            model: 'Project',
            filters: project_filters,
            limit  : Infinity,
            fetch: ['Name','ObjectID'],
            context: { 
                project: null,
                workspace: workspace.get('_ref')
            }
        }
        
        TSUtilities.loadWsapiRecords(config).then({
            success: function(projects) {
                var items = [];
                Ext.Array.each(projects, function(project){
                    var project_name = project.get('Name');
                    if ( /10\d\d\d\d/.test(project_name) ) {
                        var id = /(10\d\d\d\d)/.exec(project_name)[1];
                        items.push(Ext.create('TSProjectRow',{
                            ProjectID: id,
                            Workspace: workspace.getData(),
                            ProjectSource: 'rallyproject',
                            Project: project.getData()
                        }));
                    }
                });
                
                deferred.resolve(items);
            },
            failure: function(msg) {
                deferred.reject(msg);
            },
            scope: this
        });
        
        return deferred.promise;
    },
    
    _getPossibleProjectsFromPIs: function(workspace) {
        var me = this,
            deferred = Ext.create('Deft.Deferred'),
            project_fields = this.getSetting('projectFields') || [],
            pi_level = this.getSetting('projectPILevel') || 0;
            
        this.logger.log('pi level:', pi_level);
        
        TSUtilities.getPortoflioItemModels(workspace).then({
            success: function(pi_models) {
                if ( pi_level > pi_models.length - 1 ) { pi_level = pi_models.length - 1; }

                var pi_model = pi_models[pi_level];
                
                this.logger.log('PI Model: ', pi_model);
                var filters = [
                    {property:'Archived', operator: '!=', value: true },
                    {property:'Project.Name',operator:'!contains', value:'Archive'},
                    {property:'Project.Parent.Name',operator:'!contains', value:'Archive'}
                ];
                
                var fetch = ['ObjectID','Project','FormattedID','Workspace'];
        
                Ext.Array.each( project_fields, function(project_field) {                    
                    if ( pi_model.getField(project_field) ) {
                        filters.push({property:project_field, operator:'!=', value: ""});
                        fetch.push(project_field);
                    }
                });
                                
                var config = {
                    model: pi_model,
                    filters: filters,
                    limit  : Infinity,
                    fetch: fetch,
                    context: { 
                        project: null,
                        workspace: workspace.get('_ref')
                    }
                };
                
                TSUtilities.loadWsapiRecords(config).then({
                    success: function(portfolio_items) {
                        var items = [];
                        Ext.Array.each(portfolio_items, function(portfolio_item){
                            var id = -1;
                            Ext.Array.each( project_fields, function(project_field) {
                                if (!Ext.isEmpty(portfolio_item.get(project_field) ) ) {
                                    id = portfolio_item.get(project_field);
                                }
                            });
                         
                            if ( parseInt(id,10) > 0 ) {
                                
                                items.push(Ext.create('TSProjectRow',{
                                    ProjectID: id,
                                    Workspace: workspace.getData(),
                                    Project: portfolio_item.get('Project'),
                                    ProjectSource: 'portfolioitem'
                                }));
                            }
                        });
                                                
                        deferred.resolve(items);
                    },
                    failure: function(msg) {
                        deferred.reject(msg);
                    },
                    scope: this
                });
            },
            failure: function(msg) {
                deferred.reject(msg);
            },
            scope: this
        });
        return deferred.promise;
    },
    
    _getArtifactsFromIterationsInWorkspaces: function(workspaces) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        var promises = Ext.Array.map(workspaces, function(ws){
            return function() {
                return me._getArtifactsFromIterationsInWorkspace(ws);
            }
        });
        
        Deft.Chain.sequence(promises).then({
            success: function(results) {
                var artifacts = Ext.Array.flatten(results);
                deferred.resolve(artifacts);
            },
            failure: function(msg) {
                deferred.reject(msg);
            },
            scope: this
        });
        return deferred.promise;
    },
    
    _getArtifactsFromIterationsInWorkspace: function(workspace) {
        var me = this,
            deferred = Ext.create('Deft.Deferred');
        
        var project_fields = this.getSetting('projectFields') || [];

        this.setLoading('Loading Workspace ' + workspace.get('Name'));
        
        Deft.Chain.pipeline([
            function() { return me._getMostRecentIterationForEachProjectInWorkspace(workspace); },
            function(iterations_by_project) { return me._getArtifactsFromIterations(iterations_by_project,workspace); }
        ],this).then({
            success: function(artifacts) {
                var pi_level = this.getSetting('projectPILevel');
                
                if ( pi_level < 2 ) {
                    deferred.resolve(artifacts);
                    return;
                }
                
                // SET the grandparent so we can know the greatgrandparent
                TSUtilities.getPortoflioItemModels(workspace).then({
                    success: function(pi_models) {        
                        var pi_model = pi_models[1];
                        
                        var fetch = ['ObjectID','Project','FormattedID','Parent'];
                
                        Ext.Array.each( project_fields, function(project_field) {                    
                            if ( pi_model.getField(project_field) ) {
                                fetch.push(project_field);
                            }
                        });
                        
                        var filters = Ext.Array.map(artifacts, function(artifact){
                            var oid = -1;
                            if ( artifact.get('Feature') && artifact.get('Feature').Parent ) {
                                oid = artifact.get('Feature').Parent.ObjectID;
                            }
                            return { property:'ObjectID',value:oid };
                        });
                        
                        var config = {
                            model: pi_model,
                            filters: Rally.data.wsapi.Filter.or(filters),
                            limit  : Infinity,
                            fetch  : fetch,
                            context: { 
                                project: null,
                                workspace: workspace.get('_ref')
                            },
                            enablePostGet: true
                        };
                        
                        TSUtilities.loadWsapiRecords(config).then({
                            success: function(grandparents) {
                                this.logger.log('grandparents',  grandparents);
                                var grandparents_by_oid = {};
                                // story knows parent (feature) -> grandparent
                                // just fetched grandparents who know greatgrandparent
                                // arrange for easy setting
                                Ext.Array.each(grandparents, function(grandparent){
                                    grandparents_by_oid[grandparent.get('ObjectID')] = grandparent;
                                });
                                
                                Ext.Array.each(artifacts, function(artifact){
                                    var grandparent_oid = artifact.get('Feature') && artifact.get('Feature').Parent && artifact.get('Feature').Parent.ObjectID;
                                    var grandparent =  grandparents_by_oid[grandparent_oid];
                                    if ( grandparent) {
                                       artifact.set("__Grandparent", grandparent.getData());
                                    }
                                });
                                deferred.resolve(artifacts);
                            },
                            failure: function(msg) {
                                deferred.reject(msg);
                            },
                            scope: this
                        });
                    },
                    failure: function(msg) { deferred.reject(msg); },
                    scope: this
                });
            },
            failure: function(msg) {
                deferred.reject(msg);
            },
            scope: this
        });
        
        return deferred.promise;
    },
    
    _getArtifactsFromIterations: function(iterations_by_project_oid, workspace) {

        var iteration_filters = Rally.data.wsapi.Filter.or(
            Ext.Array.map(Ext.Object.getValues(iterations_by_project_oid), function(iteration) {
                return { property:'Iteration.ObjectID', value: iteration.get('ObjectID') };
            })
        );
        
        var archived_filters = Rally.data.wsapi.Filter.and([
            {property:'Project.Name',operator:'!contains', value:'Archive'},
            {property:'Project.Parent.Name',operator:'!contains', value:'Archive'},
            {property:'Project.Parent.Parent.Name',operator:'!contains', value:'Archive'}
        ]);
        
        var filters = iteration_filters.and(archived_filters);
        
        var config = {
            filters: filters,
            limit: Infinity,
            pageSize: 2000,
            enablePostGet: true,
            sorters: [{property:'DragAndDropRank', direction:'ASC'}],
            fetch: ['FormattedID','Iteration','StartDate', 'EndDate',
                'Name','ObjectID','PlanEstimate','AcceptedDate','Archived',
                'Project','ScheduleState','Feature','Parent','Workspace', 'c_EPMSid','c_EPMSID'],
            context: { 
                project: null,
                workspace: workspace.get('_ref')
            }
        };
        
        return TSUtilities.loadWsapiArtifactRecords(config);
    },
    
    _getMostRecentIterationForEachProjectInWorkspace: function(workspace) {
        var deferred = Ext.create('Deft.Deferred');
        
        this.logger.log('_getMostRecentIterationForEachProjectInWorkspace', workspace.get('Name'));
        var today = new Date();
        var six_months_ago = Rally.util.DateTime.add(today,'month', -6);
        
        var filters = [
            { property:'EndDate', operator: '<', value: Rally.util.DateTime.toIsoString(today) },
            { property:'EndDate', operator: '>', value: Rally.util.DateTime.toIsoString(six_months_ago) }
        ];
        
        var config = {
            model: 'Iteration',
            fetch: ['Name','ObjectID','EndDate','Project','Workspace','StartDate'],
            context: {
                project: null,
                workspace: workspace.get('_ref')
            },
            filters: filters,
            pageSize: 2000,
            limit: Infinity
        };
        
        TSUtilities.loadWsapiRecords(config).then({
            success: function(iterations) {
                deferred.resolve(this._arrangeLastIterationByProjectOID(iterations));
            },
            failure: function(msg) {
                deferred.reject(msg);
            },
            scope: this
        });
        return deferred.promise;
    },
    
    // given an array of iterations, return a hash with key=project oid, value=iteration
    _arrangeLastIterationByProjectOID: function(iterations) {
        var iteration_by_project_oid = {};
        Ext.Array.each(iterations, function(iteration){
            var project_oid = iteration.get('Project').ObjectID;
            var end_date = iteration.get('EndDate');
            if ( Ext.isEmpty(iteration_by_project_oid[project_oid]) ) {
                iteration_by_project_oid[project_oid] = iteration;
            }
            var last_end_date = iteration_by_project_oid[project_oid].get('EndDate');
            if ( end_date > last_end_date ) { 
                iteration_by_project_oid[project_oid] = iteration;
            }
        });
        return iteration_by_project_oid
    },
    
    _getWorkspaces: function(show_all_workspaces) {
        var deferred = Ext.create('Deft.Deferred');
        var current_workspace_oid = Rally.getApp().getContext().getWorkspace().ObjectID;
        
        TSUtilities.getWorkspaces().then({
            success: function(workspaces) {
                var filtered_workspaces = Ext.Array.filter(workspaces, function(workspace){
                    if ( show_all_workspaces ) {
                        return true;
                    }
                    return ( workspace.get('ObjectID') == current_workspace_oid );
                });
                deferred.resolve(filtered_workspaces);
            },
            failure: function(msg) { deferred.reject(msg); }
        });
        return deferred;
    },
    
    // cycle through the stories, get the projectid from __Grandparent.parent or from project,then add 
    // to the project objects 
    _assignArtifactsToProjects: function(projects,artifacts){
        var projects_by_id = {};
        Ext.Array.each(projects, function(project){
            projects_by_id[project.get('ProjectID')] = project;
        });
        
        Ext.Array.each(artifacts,function(artifact){
            console.log(artifact.get('FormattedID'), artifact);
            var id = this._getProjectIdFromArtifact(artifact);
            
            var project = projects_by_id[id];
            if ( project ) {
                console.log('adding ', artifact.get('FormattedID'), ' to ', project.get('ProjectID'));
                project.addArtifact(artifact);
            } else {
                console.log("No project for ", id);
            }
        },this);
        
        return Ext.Object.getValues(projects_by_id);
    },
    
    /*
     * If the PI has an ID, use that, otherwise,
     * if project name contains six digit decimal starting with 10,
     * then use the project name
     */ 
    _getProjectIdFromArtifact: function(artifact) {
        var project_source = 'none';
        var project_id = '-- NONE --';

        var project = artifact.get('Project');
        var feature = artifact.get('Feature');
        var grandparent = artifact.get('__Grandparent');
        
        var project_fields = this.getSetting('projectFields') || [];
        
        if ( grandparent && grandparent.Parent ) {
            
            var check_pi = grandparent.Parent;
            
            Ext.Array.each(project_fields, function(project_field) {
                if ( check_pi[project_field] ) {
                    project_source = 'grandparent_source';
                    project_id = check_pi[project_field];
                }
            });
            
            if ( project_source == 'grandparent_source' ) {
                console.log(project_source);
                return project_id;
            }
        }
        if ( feature && feature.Parent ) {
            Ext.Array.each(project_fields, function(project_field) {
                if ( feature.Parent[project_field] ) {
                    project_source = 'pi_source';
                    project_id = feature.Parent[project_field];
                }
            });
            
            if ( project_source == 'pi_source' ) {
                console.log(project_source);
                return project_id;
            }

        }
        
        if ( /10\d\d\d\d/.test(project.Name) ) {
            project_source = 'project';
            project_id = /(10\d\d\d\d)/.exec(project.Name)[1];
            console.log(project_source);
            return project_id;
        }
        
        return project_id;
    },
    
    _getUniqueProjectsFromArray: function(projects) {
        var project_hash = {};
        Ext.Array.each(projects, function(project){
            project_hash[project.get('ProjectID')] = project;
        });
        
        return Ext.Object.getValues(project_hash);
    },
    
    _makeGrid: function(rows) {
        var container = this.down('#display_box');
        
        container.removeAll();
        
        var store = Ext.create('Rally.data.custom.Store',{
            data: rows,
            remoteSort: false,
            pageSize: 5000
        });
        
        container.add({
            xtype: 'rallygrid',
            store: store,
            showPagingToolbar: false,
            columnCfgs: this._getColumns(),
            showRowActionsColumn: false,
            listeners: {
                scope: this,
                itemclick: function(grid, record, item, index, evt) {
                    console.log('record: ', record);
                    
                    this._displayPopupForArtifacts("Items for Project " + record.get('ProjectID'), record.get('Artifacts'));
                },
                sortchange: function(grid, column, direction, eopts) {
                    console.log('Sort!', direction, eopts, column);
                }
            }
        });
        this.down('#export_button').setDisabled(false);
    },
    
    _getColumns: function() {
        return [
            { dataIndex: 'ProjectID', text: 'EPMS ID' },
            { dataIndex: '_total', text: 'Total (Plan&nbsp;Estimate)', renderer: function(v) {
                if ( Ext.isEmpty(v) || v < 0 ) { return "N/A"; }
                return v;
            } },
            { dataIndex: '_accepted_total', text: 'Accepted (Plan&nbsp;Estimate)', renderer: function(v) {
                if ( Ext.isEmpty(v) || v < 0 ) { return "N/A"; }
                return v;
            }  },
            { dataIndex: '_accepted_percent', text: 'Accepted Percentage', renderer: function(v) {
                if ( v < 0 || Ext.isEmpty(v) ) {
                    return "N/A";
                }
                return Ext.util.Format.number(v*100,'0.0') + '%';
            }},
            { dataIndex: 'Iteration', text: 'Iteration', renderer: function(v, meta, record) {
                if ( Ext.isEmpty(v) ) { return "--"; }
                return v._refObjectName
            } },
            { dataIndex: 'Iteration', text: 'Start' , renderer: function(v, meta, record) {
                if ( Ext.isEmpty(v) ) { return "--"; }
                
                return Ext.util.Format.date(v.StartDate,"m/d/Y");
            }},
            { dataIndex: 'Iteration', text: 'End' , renderer: function(v, meta, record) {
                if ( Ext.isEmpty(v) ) { return "--"; }
                return Ext.util.Format.date(v.EndDate,"m/d/Y");
            }},
            { dataIndex: 'Project', flex: 1, text: 'Project', renderer: function(v, meta, record) {
                if ( Ext.isEmpty(v) ) { return "--"; }
                return v._refObjectName;
            }},
            { dataIndex: 'Workspace', text: 'Workspace', renderer: function(v, meta, record) {
                if ( Ext.isEmpty(v) ) { return "--"; }
                return v._refObjectName;
            } }
        ];
    },
    
    _export: function(){
        var grid = this.down('rallygrid');
        var me = this;
        
        if ( !grid ) { return; }
        
        this.logger.log('_export',grid);

        var filename = Ext.String.format('project-report.csv');

        this.setLoading("Generating CSV");
        Deft.Chain.sequence([
            function() { return Rally.technicalservices.FileUtilities.getCSVFromGrid(this,grid) } 
        ]).then({
            scope: this,
            success: function(csv){
                if (csv && csv.length > 0){
                    Rally.technicalservices.FileUtilities.saveCSVToFile(csv,filename);
                } else {
                    Rally.ui.notify.Notifier.showWarning({message: 'No data to export'});
                }
                
            }
        }).always(function() { me.setLoading(false); });
    },
    
    _displayPopupForArtifacts: function(title, artifacts) {
        if ( Ext.isEmpty(artifacts) || artifacts.length === 0 ) { return; }
        
        Ext.create('CA.technicalservices.ArtifactDisplayDialog',{
            title    : title,
            artifacts: artifacts,
            width    : Ext.getBody().getWidth() - 20,
            height   : Ext.getBody().getHeight() - 20
        });
    },
    
    getSettingsFields: function() {
        var me = this;
        
        return [{
            name: 'showAllWorkspaces',
            xtype: 'rallycheckboxfield',
            fieldLabel: 'Show All Workspaces',
            labelWidth: 135,
            labelAlign: 'left',
            minWidth: 200,
            margin: 10
        }];
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    }
    
});
