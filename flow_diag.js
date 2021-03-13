/**
 * A class corresponding to a node flow-diagram
 */
class Diagram{
    /* template format:
    TEMPLATE_NAME:
        dimensions: [width,height]
        parameters: [
            {"name":"<entry1_name>", type: , ...},
            {"name":"<entry2_name>", type: , ...},
            ... ]
        inputs: [[name,type],[name,type],...] 
        outputs:[[name,type],[name,type],...]
    */
    /*
    parameter types:
        {"name": "<name>", "type": "boolean", "default":<true/false>, "tooltip":"<text>"}
        {"name": "<name>", "type": "dropdown", "options":["<option1>", ...], "tooltip":"<text>"}
        {"name": "<name>", "type": "string_field", "default":"<default_string>", "tooltip":"<text>"}
        {"name": "<name>", "type": "num_field", "default":<default_num>, "min":<minimum>, "max":<maximum>,"step":<resolution>, "tooltip":"<text>"}
     */

    /**
     * Creates a Diagram object by passing in a division
     * @param {HTMLElement} div - an HTML div element
     * @param {Boolean} allow_user_templates - whether or not to allow users to create their own templates
     * @param {Boolean} darkmode - whether or not to enable dark mode
     */
    constructor(div , allow_user_templates = true, darkmode = false){
        this.nodes = []; // a list of all the nodes in the diagram
        this.node_templates = {}; // a list of the default node types
        this.parent = div; // the div that contains the diagram
        this.allow_user_templates = allow_user_templates; //user option to create a template
        this.darkmode = darkmode; // user option to use dark mode

        this._compatibility_table = {};//LUT for type compatibility
        /*
            If x is a key in the table, then the value is an array of all the types that
            an output terminal can be if it shares an edge with an input node of type x.

            Types are stored as a string.
        */

        div.setAttribute("class","flow_diagram");

        //scroll wheel/etc zoom in and out
        this.view_translate_X = 0;
        this.view_translate_Y = 0;
        this.view_scale = 0;
        this.view_scale_speed = 0.001;

        this.MAGIC_NODE_BASE_OFFSET = 35;
        this.MAGIC_NODE_INCREMENT = 20;
        this.MAGIC_TERMINAL_RADIUS = 5;


        //new node
        div.ondblclick = (event)=>{
            if(this.isEventOnFlow(event)){
                let bounds = this.parent.getBoundingClientRect();
                this.startNewNode(event.clientX-bounds.left, event.clientY-bounds.top);
            }
        };

        //for scrolling - all nodes are children to this
        this.pan_div = document.createElement("div");
        this.pan_div.setAttribute("class","flow_pan");
        div.appendChild(this.pan_div);

        //for graph edges
        this._initSVG();

        //right-click menu popup
        this.options = document.createElement("ul");
        this.options.setAttribute("class","context-menu");
        this.options.style.display = "none";
        this.parent.appendChild(this.options);

        //the active node
        this.selected_node = null;

        //context menu
        this.parent.oncontextmenu = e=>this._openContextMenu(e);
 
        //context menu select and drag inits
        div.onmousedown = (e)=>{
            let close_options = true;//should the options pane be closed?
            //close context menu, handle selected option if there is one
            var click_menu = this._getHoveredOption();
            //handle option
            if(click_menu !== "none" && e.button == 0){
                //we clicked on something

                //save the coordinates of the options pane
                let ctxbounds = this.options.getBoundingClientRect();

                if(this.selected_node != null){
                    if(click_menu === "Delete"){
                        this.deleteNode(this.selected_node);
                    }else if(click_menu === "Add Terminal"){
                        this._addRemoveTerminalToTemplate(this.selected_node,ctxbounds.left,ctxbounds.top, true);
                    }else if(click_menu === "Remove Terminal"){
                        this._addRemoveTerminalToTemplate(this.selected_node,ctxbounds.left,ctxbounds.top, false);
                    }else if(click_menu === "Add Parameter"){
                        this._addRemoveParameterToTemplate(this.selected_node,ctxbounds.left,ctxbounds.top, true);
                    }else if(click_menu === "Remove Parameter"){
                        this._addRemoveParameterToTemplate(this.selected_node,ctxbounds.left,ctxbounds.top, false);
                    }
                }else{
                    if(click_menu === "New Node"){
                        var bounds = this.parent.getBoundingClientRect();
                        this.startNewNode(ctxbounds.left-bounds.left, ctxbounds.top-bounds.top);
                        close_options = false;
                    }else if(click_menu === "New Template Node"){
                        if(this.allow_user_templates){

                            //find an unused name, default starts with Template
                            var template_name = "Template";
                            var i = 0;
                            while(this.node_templates.hasOwnProperty(template_name)){
                                template_name = "Template_"+i;
                                i++;
                            }
                            //create the node and template, populate lists
                            let bounds = this.parent.getBoundingClientRect();
                            let location = this.transformPanToNode(ctxbounds.left-bounds.left, ctxbounds.top-bounds.top);
                            var node = new FlowNode(this, location[0], location[1], template_name);
                            this.node_templates[template_name] = {};
                            this.nodes.push(node);
                            node.setAsTemplate();
                        }
                    }else if(click_menu.startsWith("Set Template:")){
                        //new node menu: initialize based on response
                        
                        var bounds = this.parent.getBoundingClientRect();
                        var template_name = click_menu.replace("Set Template: ","");
                        this.createNewNode(ctxbounds.left-bounds.left, ctxbounds.top-bounds.top, template_name);
                    }
                }
            }
            //close it
            if(close_options){
                this.options.style.display = "none";
            }

            //left click:
            if(e.button == 0){
                var classname = e.target.getAttribute("class");
                let target_bounds = this.parent.getBoundingClientRect();
                
                let mouseX = e.clientX - target_bounds.left;
                let mouseY = e.clientY - target_bounds.top;

                if(this.isEventOnFlow(e)){
                    /*
                        Scaling does wierd stuff with z-positioning, so we might see
                        SVG on top. thats okay.
                    */
                    //case diagram: do panning, reset selected_node
                    this.selected_node = null;

                    new FlowDragHandler(this, e);
                }

                if(classname != null){
                    if(classname === "dot-in"){
                        //input node
                        new FlowDragHandler(new EdgeControlPoint(this.hovered_node, 
                            parseInt(this.hovered_terminal.style.getPropertyValue("--terminal_index")), true, mouseX, mouseY),
                            e);
                    }else if(classname === "dot-out"){
                        new FlowDragHandler(new EdgeControlPoint(this.hovered_node, 
                            parseInt(this.hovered_terminal.style.getPropertyValue("--terminal_index")), false, mouseX, mouseY),
                            e);
                    }
                }
            }
            
        };

        //handle hovered terminals and nodes
        div.onmousemove = (e) => {
            let classname = e.target.getAttribute("class");
            if(classname != null && classname.startsWith("dot-")){
                this.hovered_terminal = e.target;
                return;
            }
            this.hovered_terminal = null;
        };

        div.onwheel = (e) => {
            //prevent manual scroll
            e.preventDefault();

            //location of mouse in pan-space before zoom
            let before = this.transformViewToPan(e.clientX, e.clientY);

            this.view_scale -= e.deltaY * this.view_scale_speed;
            this.pan_div.style.transform = `scale(${2 ** this.view_scale})`

            //location of mouse in pan-space after zoom
            let after = this.transformViewToPan(e.clientX, e.clientY)

            //we want to translate everything so that after = before
            this.view_translate_X += after[0] - before[0];
            this.view_translate_Y += after[1] - before[1];

            //update display
            this.nodes.forEach(node => node.updateDrawPosition());
            this.redrawSVG()
        };

        this.pan_offsetX = 0;
        this.pan_offsetY = 0;

    }

    /**
     * Sets the diagram's dark mode state to the given value
     * @param {Boolean} enabled - true if dark mode should be enabled
     */
    setDarkMode(enabled){
        this.darkmode = enabled;
        if(enabled){
            this.parent.style.backgroundColor = "rgb(67,69,74)";
        }else{
            this.parent.style.backgroundColor = null;
        }
    }

    //======TRANSFORMATIONS

    /**
     * Returns the point (x,y) translated into pan space.
     * 
     * View space is represented by pixels, where the origin
     * is on the upper-left corner. It is in the same coordinate
     * system as this.parent.
     * 
     * Pan space is the pixel space of the pan_div, which is
     * scaled down from absolute pixel space.
     * 
     * The value returned is an array with the first element as
     * the x-value and the second as the y-value.
     * 
     * @param {Number} x - x coordinate in view space
     * @param {Number} y - y coordinate in view space
     * @param {DomRect} screenbox - optional pass-in for the pan_div
     *              rectangle, obtained by calling
     *              pan_div.getBoundingClientRect(). If this is not
     *              passed in, this method will call it instead.
     */
    transformViewToPan(x,y, screenbox = null){
        if(screenbox == null){
            screenbox = this.pan_div.getBoundingClientRect();
        }
        let scale = 2 ** -this.view_scale
        return [(x - screenbox.left)* scale,
                (y - screenbox.top)* scale];
    }

    /**
     * Returns the point (x,y) translated into view space.
     * 
     * View space is represented by pixels, where the origin
     * is on the upper-left corner. It is in the same coordinate
     * system as this.parent.
     * 
     * Pan space is the pixel space of the pan_div, which is
     * scaled down from absolute pixel space.
     * 
     * The value returned is an array with the first element as
     * the x-value and the second as the y-value.
     * 
     * @param {Number} x - x coordinate in view space
     * @param {Number} y - y coordinate in view space
     * @param {DomRect} screenbox - optional pass-in for the pan_div
     *              rectangle, obtained by calling
     *              pan_div.getBoundingClientRect(). If this is not
     *              passed in, this method will call it instead.
     */
    transformPanToView(x,y, screenbox = null){
        if(screenbox == null){
            screenbox = this.pan_div.getBoundingClientRect();
        }
        let scale = 2 ** this.view_scale
        return [(x * scale) + screenbox.left,
                (y * scale) + screenbox.top];
    }

    /**
     * Returns the point (x,y) translated into node space.
     * 
     * Pan space is the pixel space of the pan_div, which is
     * scaled down from absolute pixel space.
     * Node space is represented by pixels in an unscaled
     * environment.
     * 
     * A transform from pan space is a translation
     * by (-this.view_translate_X, -this.view_translate_Y).
     * Scaling is handled by the pan-div.
     * 
     * The value returned is an array with the first element as
     * the x-value and the second as the y-value.
     * 
     * @param {Number} x - x coordinate in node space
     * @param {Number} y - y coordinate in node space
     */
    transformPanToNode(x,y){
        return [x - this.view_translate_X,
                y - this.view_translate_Y];
    }

    /**
     * Returns the point (x,y) translated into pan space.
     * 
     * Pan space is the pixel space of the pan_div, which is
     * scaled down from absolute pixel space.
     * Node space is represented by pixels in an unscaled
     * environment.
     * 
     * A transform from node space is a translation by
     * (this.view_translate_X, this.view_translate_Y).
     * Scaling is handled by the pan-div.
     * 
     * The value returned is an array with the first element as
     * the x-value and the second as the y-value.
     * 
     * @param {Number} x - x coordinate in node space
     * @param {Number} y - y coordinate in node space
     */
    transformNodeToPan(x, y){
        return [x + this.view_translate_X,
                y + this.view_translate_Y];
    }

    /**
     * Returns the point (x,y) translated into view space.
     * 
     * View space is represented by pixels, where the origin
     * is on the upper-left corner. It is in the same coordinate
     * system as this.parent.
     * 
     * Node space is represented by pixels in an unscaled
     * environment.
     * 
     * The value returned is an array with the first element as
     * the x-value and the second as the y-value.
     * 
     * @param {Number} x - x coordinate in view space
     * @param {Number} y - y coordinate in view space
     * @param {DomRect} screenbox - optional pass-in for the pan_div
     *              rectangle, obtained by calling
     *              pan_div.getBoundingClientRect(). If this is not
     *              passed in, this method will call it instead.
     */
    transformNodeToView(x,y, screenbox = null){
        if(screenbox == null){
            screenbox = this.pan_div.getBoundingClientRect();
        }
        let scale = 2 ** this.view_scale
        return [((x+this.view_translate_X) * scale) + screenbox.left,
                ((y+this.view_translate_Y) * scale) + screenbox.top];
    }
    //=======================

    /**
     * Returns whether or not this mouse event was targetting
     * the flow diagram.
     */
    isEventOnFlow(event){
        return event.target == this.svg ||
            event.target.getAttribute("class")!= null && event.target.getAttribute("class").startsWith("flow_");
    }

    /**
     * @private
     * Event handler for the context menu to open
     * @param {Event} event 
     * 
     */
    _openContextMenu(event){
        //draw the options pane, set "selected" node to null
        if(this.isEventOnFlow(event)){
            if(this.allow_user_templates){
                this._displayContextMenu(event.clientX,event.clientY,"<li>New Node</li><li>New Template Node</li>");
            }else{
                this._displayContextMenu(event.clientX,event.clientY,"<li>New Node</li>");
            }
            
            this.selected_node = null;
            event.preventDefault();
        }
    }

    /**
     * Gets the y-offset of a terminal based on it's index.
     * 
     * @param {Number} index - the index of the terminal
     */
    nodeTerminalIndexOffset(index){
        return this.MAGIC_NODE_BASE_OFFSET +
            index * this.MAGIC_NODE_INCREMENT;
    }

    /**
     * Guesses the terminal index from a y-offset.
     * 
     * @param {Number} y - the number of pixels below
     * the top of the node. This is in the node's space, which
     * is scaled due to the pan_div.
     */
    nodeTerminalIndexFromOffset(y){
        return Math.max(0, // lower bound is 0
                Math.round(
                        (y-this.MAGIC_NODE_BASE_OFFSET + this.MAGIC_TERMINAL_RADIUS)
                        // shifted so that 0 represents the center of the 0th terminal

                    /this.MAGIC_NODE_INCREMENT// scaled so that the nearest integer
                        // is the nearest terminal index
                )
            );
    }

    /**
     * Deletes the given node and updates the display
     * @param {FlowNode} node node to delete
     */
    deleteNode(node){
        this.selected_node.delete();
        //remove the node from the list
        this.nodes.splice(this.nodes.indexOf(this.selected_node),1);
        //just redraw all the edges because ids of nodes are now offset
        this.svg.remove();
        this._initSVG();
        this.redrawSVG();
    }
    /**
     * Initialized when a user clicks for a new node: displays the context menu for templates,
     */
    startNewNode(x, y){
        if(Object.keys(this.node_templates).length > 0){
            var templateHTML = "";
            for(let tem of Object.keys(this.node_templates)){
                templateHTML += "<li>Set Template: "+tem+"</li>"
            }
            this._displayContextMenu(x,y,templateHTML);
        }

    }

    /**
     * Creates a new node at the given location with the given template.
     * Locations are specified in View Space
     * 
     * @param {Number} x 
     * @param {Number} y 
     * @param {string} template_name 
     */
    createNewNode(x, y, template_name){
        let location = this.transformPanToNode(x, y);
        this.nodes.push(new FlowNode(this, location[0], location[1], template_name));
    }

    /**@private initializes the svg object*/
    _initSVG(){
        this.svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
        this.svg.style = "width: 100%; height:100%; position: absolute; z-index: -100;";
        this.parent.appendChild(this.svg);
    }

    /** 
     * @private
     * returns whatever option is being hovered in the context menu as a string.
     * "none" if no option is being hovered
     */
    _getHoveredOption(){
        //make sure options are shown
        if(this.options.style.display !== "none"){
            let children = this.options.childNodes;
            for(let i = 0; i < children.length; i++){
                //loop until we find a child that's hovered, ie they have a different color
                let child = children[i];
                if(window.getComputedStyle(child).outlineStyle === "solid"){
                    return child.innerText;
                }
            }
        }
        return "none";
    }
    /**
     * @private
     * Displays the content menu at the given coordinates
     * @param {Number} x        coordinates in View space
     * @param {Number} y        coordinates in View space
     * @param {string} content  html to be contained in the context menu
     */
    _displayContextMenu(x,y,content){
        this.options.innerHTML = content;
        this.options.style.display = "block";
        var bounds = this.parent.getBoundingClientRect();
        this.options.style.left = x-bounds.left+"px";
        this.options.style.top = y-bounds.top+"px";
    }

    //called on mouse dragging
    dragShift(deltaX, deltaY){
        //set the pan of the division so that we only have to modify 1 element
        this.pan_offsetX += deltaX;
        this.pan_offsetY += deltaY;
        this.pan_div.style.left=this.pan_offsetX+"px";
        this.pan_div.style.top=this.pan_offsetY+"px";
        
        this.svg.style.left=this.pan_offsetX+"px";
        this.svg.style.top=this.pan_offsetY+"px";
    }

    
    //called when mouse dragging is done
    dragComplete(){
        //the dragging is in mouse space. We need to account for this
        let scale = 2 ** -this.view_scale
        this.view_translate_X += this.pan_offsetX * scale;
        this.view_translate_Y += this.pan_offsetY * scale;
        this.nodes.forEach((child)=>{
            child.updateDrawPosition();
        });
        //reset accumulator
        this.pan_offsetX = 0;
        this.pan_offsetY = 0;
        //reset position to 0
        this.pan_div.style.left="0px";
        this.pan_div.style.top="0px";
        this.svg.style.left="0px";
        this.svg.style.top="0px";
        //redraw the edges
        this.redrawSVG();
    }

    /**
     * Redraws links between nodes, call when something moves
     * @param {Array<FlowNode>} nodes the list of all nodes that changed, null redraws them all
     */
    redrawSVG(nodes = null){
        if(nodes == null)
            nodes = this.nodes;

        //client rectangle for transformations
        let pan_box = this.pan_div.getBoundingClientRect();

        nodes.forEach((node)=>{
            //iterate each in-edge, if it does come from a node in this list,
            //because we iterate each out-edge in the list
            node.current_state.inputs.forEach((input, index) => {
                //inputs contains arrays where 1st entry is source node
        //input: [<source node>, <output index in source node>]
                if(input != null && !nodes.includes(input[0])){
                    //find index2
                    
                    var out = input[0].current_state.outputs[input[1]];
                    this._drawNodeEdge(input[0],input[1], node, index, pan_box);
                }
            });

            //iterate each out-edge
            node.current_state.outputs.forEach((output,index) =>{
        //output: [[<target node>, <input index in target node>, <svg path reference>],...]
                output.forEach((outedge) => {
                    if(output != null){
                        this._drawNodeEdge(node,index, outedge[0], outedge[1], pan_box);
                    }
                })
            });
        });
    }

    /**
     * @private
     * Draws a node edge from one node to another, deleting the old one if it exists
     * @param {FlowNode} outnode the node that has the output
     * @param {Number} outindex the index of the output
     * @param {FlowNode} innode the node that has the output
     * @param {Number} inindex the index of the output
     * @param {DomRect} pan_box - optional pass-in for the pan_div
     *              rectangle, obtained by calling
     *              pan_div.getBoundingClientRect(). If this is not
     *              passed in, this method will call it instead.
     */
    _drawNodeEdge(outnode, outindex, innode, inindex, pan_box = null){

        const MAGIC_DRAW_BEZIER_OFFSET = 100;
        let edge_offset = MAGIC_DRAW_BEZIER_OFFSET * (2 ** this.view_scale);
        
        if(pan_box == null){
            pan_box = this.pan_div.getBoundingClientRect();
        }

        //outputs = [[<target node>, <input index in target node>, <svg path reference>],...]
        let outputs = outnode.current_state.outputs[outindex];
        //outputs should never be null
        if(outputs == null)
            return;
        outputs.forEach((out, outindex2)=>{
            //don't handle if out does not map to innode, inindex; or is null
            if(out == null || out[0] != innode || out[1] != inindex){
                return;
            }

            //draw if null, otherwise update
            let edge;
            let edgeref = "node_edge_"+this.nodes.indexOf(innode)+"_"+inindex;
            if(out[2] != null && edgeref == out[2] && (edge = document.getElementById(out[2])) != null){
                let out_ = this.transformNodeToView(
                    this.node_templates[outnode.template_name].dimensions[0] + outnode.x,
                    outnode.y + this.nodeTerminalIndexOffset(outindex),
                    pan_box
                )
                let in_ = this.transformNodeToView(
                    innode.x,
                    innode.y + this.nodeTerminalIndexOffset(inindex),
                    pan_box
                )
                edge.setAttribute("d","M "+out_[0]+" "+out_[1]+" C "+(out_[0] + edge_offset)+" "+
                        out_[1]+" "+(in_[0] - edge_offset)+" "+in_[1]+" "+in_[0]+" "+in_[1]);
            }else{
                edge = document.createElement("path");
                out[2] = edgeref;
                let out_ = this.transformNodeToView(
                    this.node_templates[outnode.template_name].dimensions[0] + outnode.x,
                    outnode.y + this.nodeTerminalIndexOffset(outindex),
                    pan_box
                )
                let in_ = this.transformNodeToView(
                    innode.x,
                    innode.y + this.nodeTerminalIndexOffset(inindex),
                    pan_box
                )
                edge.setAttribute("d","M "+out_[0]+" "+out_[1]+" C "+(out_[0] + edge_offset)+" "+out_[1]+" "+
                        (in_[0] - edge_offset)+" "+in_[1]+" "+in_[0]+" "+in_[1]);
                edge.setAttribute("fill","none");
                edge.setAttribute("stroke","black");
                edge.setAttribute("stroke-width","2");
                edge.setAttribute("id",edgeref);
                outnode.diagram.svg.appendChild(edge);
                outnode.diagram.svg.innerHTML += "";
            }
        });
    }

    /**
     * Loads the nodes and templates from a given json file. If a top level entry does not exist, ignores it, otherwise overwrites/uses them.
     * 
     * 
        {

            "templates":{"TEMPLATE_NAME":{...},...} #follows template format
            
            "nodes":[{"coordinates":[x,y],"template":"<template_name>","is_template":<true:1/false:0>,"state":{...}},...]
            #follows current_state,but node references are indices in array

        }

        If a node has invalid coordinates or template name, it is thrown out. When handling node edges, only looks at inputs in the node state.
     * @param {string} json string representing json text
     * @param {Boolean} should_overwrite whether the passed json overwrites the current configuration or appends to it, defaulting to overwrite
     */
    loadJSON(json, should_overwrite = true){
        //loaded object
        let obj = JSON.parse(json);

        //handle templates: break into cases based on overwriting
        //when the loaded object has no template field, we do nothing
        if(obj.templates != null){
            if(should_overwrite){
                //replace on overwrite
                this.node_templates = obj.templates;
            }else{
                //append on no overwrite
                this.node_templates = Object.assign(this.node_templates, obj.templates);
            }
        }

        //handle nodes: clear if overwriting
        //do nothing when the loaded object has no nodes field.
        if(obj.nodes != null){
            if(should_overwrite){
                //clear the nodes
                this.nodes.forEach((node)=>node.delete());
                this.nodes = [];
            }

            //start by creating new nodes for each entry in the loaded object
            let append_arr =[];
            //indices in the json will be maintained in append_arr
            obj.nodes.forEach((node, i)=>{
                let coords = node.coordinates;
                let template = node.template;
                if(isNaN(coords[0]) || isNaN(coords[1]) ||
                        !this.node_templates.hasOwnProperty(node.template)){
                    //bad formatting, so we don't add this node
                    //push a null so we don't offset indices, though
                    append_arr.push(null);
                }else{
                    //init a new node object and populate the fields
                    let fnode = new FlowNode(this, coords[0], coords[1], template);
                    if(node.state != null){
                        fnode.current_state.parameters = node.state.parameters;
                        if(node.is_template == 1){
                            let template_ref = obj.templates[template];
                            fnode.body.style.width = template_ref.dimensions[0];
                            fnode.body.style.height = template_ref.dimensions[1];
                            fnode.setAsTemplate();
                        }
                        fnode.current_state.inputs = [];
                        fnode.current_state.outputs = [];
                    }
                    append_arr.push(fnode);
                }
            });
            //now set inputs/outputs according to obj, by using append_arr
            obj.nodes.forEach((node, i)=>{
                if(node != null){
                    let inputs = obj.nodes[i].state.inputs;
                    inputs.forEach((input, inI)=>{
                        try{
                            if(input == null){
                                return;
                            }
                            //set the input node from integer to reference
                            input[0] = append_arr[input[0]];
                            append_arr[i].current_state.inputs[inI] = input;

                            //set the output to the i'th node's input
                            let out = input[0].current_state.outputs[input[1]];
                            // out is an array with output references, or it hasn't been instantiated
                            if(out == null){
                                out = [];
                                input[0].current_state.outputs[input[1]] = out;
                            }
                            out.push([append_arr[i],inI,null]);
                            
                        }catch(e){}
                    });
                }
                //reload the template so the correct values are populated
                append_arr[i].reloadTemplate();
            });

            this.nodes.push(...append_arr.filter(n=>n!=null));
        }
        
        //just redraw everything
        this.svg.remove();
        this._initSVG();
        this.redrawSVG();
    }

    /**
     * Returns the state of this diagram as a JSON string
     */
    exportJSON(){
        //save object: we wil convert this to JSON
        let obj = {};
        
        //templates is trivial: copy the entire thing into the save object
        obj.templates = this.node_templates;

        //copy node values
        obj.nodes = Array(this.nodes.length);
        this.nodes.forEach((node,index) => {
            let objNode = {};
            objNode.coordinates = [node.x, node.y];
            objNode.template = node.template_name;
            objNode.is_template = node.is_template? 1:0;
            objNode.state = {"parameters":[],"inputs":[],"outputs":[]};//init deep copy
            //swap node input/output with indices:

            //inputs
            node.current_state.inputs.forEach((input,i)=>{
                //input is always in the form: [node, terminal]
                if(input == null)//empty case: leave that entry empty
                    return;
                let inp = [...input];
                //convert reference to index and update the entry
                inp[0] = this.nodes.indexOf(inp[0]);
                objNode.state.inputs[i] = inp;
            });

            //outputs
            node.current_state.outputs.forEach((output, i)=>{
                if(output == null)//empty case: leave that entry empty
                    return;
                let out = [];
                output.forEach((ref)=>{
                    //ref is always in the form: [node, terminal, edge ID]
                    let edge = [null,ref[1]];
                    //convert reference to index and update the entry
                    edge[0] = this.nodes.indexOf(ref[0]);
                    out.push(edge);
                });
                objNode.state.outputs[i] = out;
            });

            //copy over internal states and add this to the save object
            objNode.state.parameters = node.current_state.parameters;//won't be modified
            obj.nodes[index] = objNode;
        });
        return JSON.stringify(obj);
    }

    /**
     * The table of type compatibilities. An output of type A
     * is considered with an input of type B if A is in the array
     * keyed by B. That is,
     *
     * compatible = (A in compatibility_table[B])
     *
     * A deep copy is made each time this property is gotten, so
     * modification must be done by using the setter. The setter
     * creates a copy, so modification of the passed value does not
     * do anything to the diagram. Typing is checked, and any non-string
     * values are ignored.
     */
    get compatibility_table(){
        var table_clone = {};
        for(let dest in this._compatibility_table){
            table_clone[dest] = [...this._compatibility_table[dest]];
        }
        return table_clone;
    }

    /**
     * The table of type compatibilities. An output of type A
     * is considered with an input of type B if A is in the array
     * keyed by B. That is,
     *
     * compatible = (A in compatibility_table[B])
     *
     * A deep copy is made each time this property is gotten, so
     * modification must be done by using the setter. The setter
     * creates a copy, so modification of the passed value does not
     * do anything to the diagram. Typing is checked, and any non-string
     * values are ignored.
     */
    set compatibility_table(table){
        if(typeof(table) !== "object"){
            throw new TypeError("table is not an object!");
        }
        var table_clone = {};
        for(let dest in table){
            //table should only have string keys
            if(typeof(dest) !== "string"){
                continue;
            }
            let arr = [];
            // copy only string entries
            for(let src of table[dest]){
                if(typeof(src) === "string")
                    arr.push(src);
            }
            table_clone[dest] = arr;
        }
        this._compatibility_table = table_clone;
    }

    /**
     * Returns whether or not two types are compatible. Compatibility is determined by
     * the look-up table, compatibility_table, in the diagram, which stores a list of
     * destination types as keys and their corresponding arrays of their compatible
     * source types as values.
     * 
     * If the LUT does not have an entry for the destination, compatibility is determined
     * by equality.
     * 
     * @param {string} source - The type of the output terminal leading to the destination.
     * @param {string} destination - The type of the input terminal receiving from the source.
     */
    areTypesCompatible(source, destination){
        //check if destination is in the table
        if(this._compatibility_table.hasOwnProperty(destination)){
            //it is, so make sure the source has a compatible type
            return this._compatibility_table[destination].includes(source);
        }else{
            //it isn't, so default to only allow compatibility with equality
            return source === destination;
        }
    }

    /**
     * Links two nodes from the output of one terminal to the input of the other if they
     * are compatible.
     * @param {FlowNode} output_node Node with the output terminal
     * @param {Number} output_index Index of the output terminal
     * @param {FlowNode} input_node Node with the input terminal
     * @param {Number} input_index Index of the input terminal
     */
    linkNodes(output_node, output_index, input_node, input_index){
        //type check terminals
        if(!this.areTypesCompatible(
                    this.node_templates[output_node.template_name].outputs[output_index][1],
                    this.node_templates[input_node.template_name].inputs[input_index][1])
                )
            //incompatible types, so do not link
            return;
        
        //set input to output ref
        if(input_node.current_state.inputs[input_index] != null){
            //delete edge that points here
            let input = input_node.current_state.inputs[input_index];
            if(input[0] != null){
                let output = input[0].current_state.outputs[input[1]];
                if(output != null){
                    input[0].current_state.outputs[input[1]] = output.filter(edge=>edge[0] != input_node || edge[1] != input_index);
                    this.svg.remove();
                    this._initSVG();
                    this.redrawSVG();
                }
            }
        }
        input_node.current_state.inputs[input_index] = [output_node, output_index];

        //get output
        let outputs = output_node.current_state.outputs;
        if(outputs[output_index] == null)
            outputs[output_index] = [];
        //append input ref to that
        outputs[output_index].push([input_node, input_index, null]);
        this._drawNodeEdge(output_node, output_index, input_node, input_index);
    }

    
    
    /**
     * Adds, removes, or toggles the presence of a parameter at a clicked point in a node
     * @param {FlowNode} node the node to operate on
     * @param {Number} x coordinates of the click in client space
     * @param {Number} y coordinates of the click in client space
     * @param {Boolean} adding if this as an add or remove operation, null if toggle
     */
     _addRemoveParameterToTemplate(node, x, y, adding=null){

        if(node != null && node.is_template){
            var bounds = node.body.getBoundingClientRect();
            x = x-bounds.left;
            y = y-bounds.top;

            //scale y from view space to get a proper height on the node
            let scale = 2 ** -this.view_scale
            y *= scale;
            
            //lock vertical, highest is 30 px, then each one below is +20px
            let terminal_index = this.nodeTerminalIndexFromOffset(y);
            y = this.nodeTerminalIndexOffset(terminal_index) - this.MAGIC_TERMINAL_RADIUS;

            if(node.template.parameters == null){
                node.template.parameters = [];
            }
            if(node.template.parameters[terminal_index] == null && (adding == null || adding == true)){
                node.template.parameters[terminal_index] = {"name": "Param", "type": "string_field", "default":"", "tooltip":"Tooltip"};
            }else if(node.template.parameters[terminal_index] != null && (adding == null || adding == false)){
                node.template.parameters[terminal_index] = null;
            }
            this.onTemplateModify(node);
        }
    }

    
    /**
     * Adds, removes, or toggles the presence of a terminal at a clicked point in a node
     * @param {FlowNode} node the node to operate on
     * @param {Number} x coordinates of the click in client space
     * @param {Number} y coordinates of the click in client space
     * @param {Boolean} adding if this as an add or remove operation, null if toggle
     * 
     * @private
     */
    _addRemoveTerminalToTemplate(node, x, y, adding=null){
        if(node != null && node.is_template){
            var bounds = node.body.getBoundingClientRect();
            x = x-bounds.left;
            y = y-bounds.top;

            //scale y from view space to get a proper height on the node
            let scale = 2 ** -this.view_scale;
            y *= scale;
            
            //lock vertical, highest is 30 px, then each one below is +20px
            var terminal_index = this.nodeTerminalIndexFromOffset(y);
            y = this.nodeTerminalIndexOffset(terminal_index) - this.MAGIC_TERMINAL_RADIUS;

            //lock horizontal by finding if it's an in or out
            if(x < bounds.width/2){
                //x is on left side, so we create an in-terminal
                if(node.template.inputs == null){
                    node.template.inputs = [];
                }
                if(node.template.inputs[terminal_index] == null && (adding == null || adding == true)){
                    node.template.inputs[terminal_index] = ["Input","any"];
                }else if(node.template.inputs[terminal_index] != null && (adding == null || adding == false)){
                    node.template.inputs[terminal_index] = null;
                }
                
            }else{
                //x is on right side, so we create an out-terminal
                if(node.template.outputs == null){
                    node.template.outputs = [];
                }
                if(node.template.outputs[terminal_index] == null && (adding == null || adding == true)){
                    node.template.outputs[terminal_index] = ["Output","any"];
                }else if(node.template.outputs[terminal_index] != null && (adding == null || adding == false)){
                    node.template.outputs[terminal_index] = null;
                }
            }
            this.onTemplateModify(node);
        }
    }

    
    /**
     * Called when a template node is modified and should be updated
     * @param {FlowNode} selected_node 
     */
    onTemplateModify(selected_node){
        //ensure it's a template
        if(selected_node != null && selected_node.is_template){
            //make title uneditable and update the template

            //store old name and new name in local variable
            var old_template = selected_node.template_name;
            var new_template = selected_node.title.value;
            //cancel if new template name is already taken on name change
            if(old_template != new_template && this.node_templates.hasOwnProperty(new_template)){
                selected_node.title.value = old_template;
                alert("That name already exists.");
                return;
            }
            //add template structure under new name
            this.node_templates[new_template] = selected_node.template;

            //only do if the name changed
            if(old_template != new_template){
                //delete old template structure
                delete this.node_templates[selected_node.template_name];
                //iterate over all nodes and replace the template names, including the template node
                for(let node of this.nodes){
                    if(node.template_name == old_template){
                        node.changeTemplate(new_template);
                    }
                }
            }else{
                //redraw a node if it's the same as the modified template
                for(let node of this.nodes){
                    if(node.template_name == old_template){
                        node.reloadTemplate();
                    }
                }
            }
            selected_node.title.setAttribute("readonly","");
        }
    }

}
/**
 * A class for drawing an edge while it's being created
 */
class EdgeControlPoint{

    /**
     * Creates an EdgeControlPoint that manages the edge that the user is currently creating.
     * This edge is represented only in SVG as a path between the current mouse location and
     * the terminal the user started drawing from.
     * 
     * @param {FlowNode} node the node source
     * @param {Number} index the index of the input/output of the node
     * @param {Boolean} is_input whether or not the node terminal is on the input side
     * @param {Number} x coordinates of the current drag location
     * @param {Number} y coordinates of the current drag location
     * @param {Number} control_dist the distance for the control points on the bezier curve
     */
    constructor(node,index,is_input,x,y, control_dist = 100){
        this.node = node;
        this.index = index;
        this.is_input = is_input;
        this.x = x;
        this.y = y;
        this.diagram = node.diagram;
        this.control_dist = control_dist;

        //create path and append to diagram's svg
        this.svgpath = document.createElementNS("http://www.w3.org/2000/svg","path");
        this.svgpath.setAttribute("fill","none")
        this.svgpath.setAttribute("stroke","black")
        this.svgpath.setAttribute("stroke-width","2")
        node.diagram.svg.appendChild(this.svgpath);

        //get the terminal location in view space. y position is offset by the node index
        if(this.is_input){
            //x position is on the left side
            this.node_position = this.diagram.transformNodeToView(
                    this.node.x,
                    this.node.y + this.node.diagram.nodeTerminalIndexOffset(this.index)
                )
        }else{
            this.control_dist *= -1;
            //x position is on the right side, so add by the width given by the template
            this.node_position = this.diagram.transformNodeToView(
                    this.node.x + this.diagram.node_templates[this.node.template_name].dimensions[0],
                    this.node.y + this.node.diagram.nodeTerminalIndexOffset(this.index)
                )
        }
        //draw the path with no offset
        this.dragShift(0,0);
    }
    _redrawSVGpath(x1, y1, x2, y2){
        this.svgpath.setAttribute("d","M "+x1+" "+y1+" C "
            +(x1 + this.control_dist)+" "+y1+" "+(x2-this.control_dist)+" "+y2 + " " + x2+" "+y2);
    }
    dragShift(deltaX, deltaY){
        //update coordinates and the "d" attribute with the new coordinates
        this.x += deltaX;
        this.y += deltaY;
        this._redrawSVGpath(this.x, this.y, this.node_position[0], this.node_position[1]);
    }
    dragComplete(){
        //delete path, see if we should form edge
        this.svgpath.remove();

        //we form an edge if a node's terminal is hovered (not this one) (class="dot-out" if this.is_input, class="dot-in" otherwise)
        if(this.diagram.hovered_terminal != null && this.diagram.hovered_node != null && this.diagram.hovered_node != this.node){
            if(this.is_input){
                if(this.diagram.hovered_terminal.getAttribute("class") === "dot-out"){
                    //output index is based on style y of terminal
                    let outI = parseInt(this.diagram.hovered_terminal.style.getPropertyValue("--terminal_index"));
                    this.diagram.linkNodes(this.diagram.hovered_node,outI, this.node, this.index);
                }
            }else{
                if(this.diagram.hovered_terminal.getAttribute("class") === "dot-in"){
                    //input index is based on style y of terminal
                    let inI = parseInt(this.diagram.hovered_terminal.style.getPropertyValue("--terminal_index"));
                    this.diagram.linkNodes(this.node, this.index, this.diagram.hovered_node, inI);
                }
            }
        }
    }
}

/**
 * Class for handling events with mouse dragging. Handled objects
 * must have have dragShift() and dragComplete() methods.
 */
class FlowDragHandler{

    /**
     * 
     * @param {Object} target - the object that is handled by dragging
     * @param {MouseEvent} event - the event that initializes the drag
     */
    constructor(target, event){
        this.updating = target;
        this.flowDragInit(event);
    }
    /*    FORMAT:
    updating (object):
        object must have dragShift() and dragComplete() methods
    */

    /*
        dragX and dragY are mouse locations.

        deltaX and deltaY are the change in the last frame.
    */

    flowDragInit(e){
        this.dragX = e.clientX;
        this.dragY = e.clientY;
        document.onmouseup = e => this.flowDragExit(e);
        document.onmousemove = e => this.flowDragMove(e);
    }

    //called when moving during drag
    flowDragMove(e){
        let deltaX = e.clientX - this.dragX;
        let deltaY = e.clientY - this.dragY;

        this.dragX = e.clientX;
        this.dragY = e.clientY;

        this.updating.dragShift(deltaX, deltaY);
        e.preventDefault();
    }

    //called when letting go of a drag move
    flowDragExit(e){
        document.onmouseup = null;
        document.onmousemove = null;
        this.updating.dragComplete();
        delete this;
    }
}

//===============for handling nodes=========================



/**
 * A class for each node in a node flow-diagram
 */
class FlowNode{
    /**
     * 
     * @param {Diagram} diagram     diagram object that the node should be a child of
     * @param {Number} x            coordinates of the node in node space
     * @param {Number} y            coordinates of the node in node space
     * @param {string} template     the name of the template to use
     */
    constructor(diagram, x,y, template){
        // the input fields with the data
        this.bodyEntries = {};

        this.diagram = diagram;

        //whether or not this is a template
        this.is_template = false;
        this.template_name = template;

        // current state of the node
        this.current_state = {"parameters":[],"inputs":[],"outputs":[]};
        /*
        current_state is an object with the following format
        {"parameters":[],"inputs":[],"outputs":[]}

        where parameters, inputs, and outputs are arrays of the corresponding values

        each element of inputs and outputs
        input: [<source node>, <output index in source node>]
        output: [[<target node>, <input index in target node>, <svg path reference>],...]

        you can have multiple outputs, so that is a list
        */

        //create div for this node
        this.parent = document.createElement("div");
        this.parent.setAttribute("class","node_parent");
        this.drag = document.createElement("div");
        this.drag.setAttribute("class","node_drag");
        this.body = document.createElement("div");
        this.body.setAttribute("class","node_body");
        this.title = document.createElement("input");
        this.title.value = template;
        this.title.setAttribute("readonly","");
        this.title.onchange = (e)=>{this.diagram.onTemplateModify(this)};

        //set the template to follow, or template name
        this.title.ondblclick = (e)=>{this.templateInteract(e);};
        this.title.oncontextmenu = (e)=>{
            this.templateInteract(e);
            e.preventDefault();}


        this.drag.appendChild(this.title);
        this.parent.appendChild(this.body);
        this.parent.appendChild(this.drag);

        

        diagram.pan_div.appendChild(this.parent);
        
        // coordinates
        this.x = x;
        this.y = y;
        this.updateDrawPosition();

        this.drag.onmousedown = (e)=>{
            //left click only for drag
            if(e.button == 0){
                //do dragging
                new FlowDragHandler(this, e);

                //highlight/select this node
                this.diagram.selected_node = this;
            }
        };

        //context menu
        this.body.oncontextmenu = (e)=>{
            let classname = e.target.getAttribute("class");
            if(classname === "dot-in"){
                //delete input edge
                let index = parseInt(e.target.style.getPropertyValue("--terminal_index"));
                let input = this.current_state.inputs[index];
                let path = document.getElementById("node_edge_"+this.diagram.nodes.indexOf(this)+"_"+index);
                if(path != null)
                    path.remove();
                let outnodeoutput = input[0].current_state.outputs[input[1]];
                //iterate each edge leaving, and remove if it points to this input
                input[0].current_state.outputs[input[1]] = outnodeoutput.filter(
                                edge => edge[0] != this || edge[1] != index);
                this.current_state.inputs[index] = null;
            }else if(classname === "dot-out"){
                //delete all output edges
                let index = parseInt(e.target.style.getPropertyValue("--terminal_index"));
                let output = this.current_state.outputs[index];
                output.forEach(edge=>{
                    let path = document.getElementById("node_edge_"+this.diagram.nodes.indexOf(edge[0])+"_"+edge[1]);
                    if(path != null)
                        path.remove();
                    edge[0].current_state.inputs[edge[1]] = null;
                });
                this.current_state.outputs[index] = [];
            }else{
                //draw the options pane, set "selected" node to this one
                if(this.is_template){
                    this.diagram._displayContextMenu(e.clientX, e.clientY, "<li>Add Terminal</li><li>Remove Terminal</li><li>Add Parameter</li><li>Remove Parameter</li><li>Delete</li>");
                }else{
                    this.diagram._displayContextMenu(e.clientX,e.clientY,"<li>Delete</li>");
                }
                this.diagram.selected_node = this;
            }
            e.preventDefault();
        }

        this.body.onmouseover = (e)=>{
            this.diagram.hovered_node = this;
        }

        //now populate
        this.reloadTemplate();
    }
    /**
     * called when listened to for interacting with the template name on right click
     * @param {Event} e     the event of the listener
     */
    templateInteract(e){
        if(this.is_template){
            //let template name be editable
            this.title.removeAttribute("readonly");
        }else{
            this.diagram.selected_node = this;
        }
    }
    /**
     * Deletes this node and its edges from the document. does not remove from diagram.nodes
     */
    delete(){
        this.marked_delete = true;
        //remove in and out edges from other node
        this.current_state.inputs.forEach((input, index)=>{
            if(input == null)//handle empties
                return;
            //get the output that this input is referencing
            let outnodeoutput = input[0].current_state.outputs[input[1]];
            //iterate each edge leaving, and remove if it points to this input
            input[0].current_state.outputs[input[1]] = outnodeoutput.filter(
                edge => edge[0] != this || edge[1] != index);
        });
        this.current_state.outputs.forEach((output)=>{
            if(output == null)//handle empties
                return;
            //delete the references where this output is pointing
            output.forEach((edge) => {
                edge[0].current_state.inputs[edge[1]] = null;
            });
        });

        this.parent.remove();
        
    }
    /**
     * Call to change the template
     * @param {string} template_name    the name of the template to change to
     * 
     */
    changeTemplate(template_name){
        if(!this.diagram.node_templates.hasOwnProperty(template_name)){
            return;
        }
        if(this.template_name != template_name){
            this.template_name = template_name;
            this.current_state = {"parameters":[],"inputs":[],"outputs":[]};
            this.reloadTemplate();
            this.title.value = template_name;
        }
    }

    /**
     * Reloads the node with the diagram's template properties.
     * Call this whenever a template changes.
     */
    reloadTemplate(){
        //delete internal html (terminals and parameter display)
        this.body.innerHTML = "";

        //if parameters are empty, set them to the template default values
        let template = this.diagram.node_templates[this.template_name];
        if(!template){
            return;
        }
        if(template.parameters){
            template.parameters.forEach((param, index) => {
                if(param != null && this.current_state.parameters[index] == undefined){
                    //set the default value
                    if(param.type === "dropdown"){
                        //special case: dropdown: default to the first one
                        this.current_state.parameters[index] = param.options[0];
                    }
                    if(param.default != undefined){
                        this.current_state.parameters[index] = param.default;
                    }
                }
            });
        }

        this.nodePopulate();
    }

    /**
     * Makes this node a template node
     */
    setAsTemplate(){
        this.is_template = true;
        this.drag.setAttribute("class","node_drag_template");
        this.template = this.diagram.node_templates[this.template_name];
        //null or undefined, just make it blank
        if(this.template == null){
            this.template = {};
        }

        //resizability and having it transfer to the template
        this.body.style = "resize:both; overflow: auto;";
        new ResizeObserver((e)=>{
            if(this.marked_delete == null){
                //set template reference variables
                this.template.dimensions = [this.body.offsetWidth, this.body.offsetHeight];
                //update diagram dictionary and redraw
                this.diagram.onTemplateModify(this);
            }
        }).observe(this.body);

        this.body.ondblclick = (e)=>{
            //cancel if not specifically clicking on the node
            if(e.target.getAttribute("class") != "node_body"){
                return;
            }
            //center 3rd will create new parameter, otherwise make input/output
            var bounds = this.body.getBoundingClientRect();
            var x = (e.clientX-bounds.left);
            if(x > .33 * bounds.width && x < .66 * bounds.width){
                this.diagram._addRemoveParameterToTemplate(this, e.clientX, e.clientY);
            }else{
                this.diagram._addRemoveTerminalToTemplate(this, e.clientX, e.clientY);
            }
        };

    }

    /**
     * Sets the style positioning of this node according to
     * this.x and this.y.
     * 
     * The position is translated from Node space to View space,
     * and the style left/top fields are set accordingly.
     */
    updateDrawPosition(){
        let coords = this.diagram.transformNodeToPan(this.x, this.y);
        this.parent.style.left=`${coords[0]}px`;
        this.parent.style.top =`${coords[1]}px`;
    }
    
    //called on mouse dragging
    dragShift(deltaX, deltaY){
        let scale = 2 ** -this.diagram.view_scale;
        //offset this node
        this.x += deltaX * scale;
        this.y += deltaY * scale;
        this.updateDrawPosition();
        this.diagram.redrawSVG([this]);
    }

    /**
     * Returns all nodes that a given output terminal points to. Returns undefined if
     * the terminal does not exist, or null if there are no output nodes. If a string is passed
     * and multiple terminals have the same name, uses the last one.
     * @param {Number|string} output the output terminal to examine
     */
    getOutputTargets(output){
        //convert string to num
        if(typeof(output) === "string"){
            this.diagram.node_templates[this.template_name].outputs.forEach((out,i)=>{
                if(out != null && out[0] === output){
                    output = i;
                }
            });
        }
        //if it's not a number, we have illegal state
        if(typeof(output) !== "number" || this.current_state.outputs[output] == null){
            return undefined;
        }
        //outputs[x] is array, where each element's first entry is the target node
        return this.current_state.outputs[output].map(val=>val[0]);
    }
    /**
     * Returns all nodes that a given input terminal points to. Returns undefined if
     * the terminal does not exist, or null if there are no input nodes. If a string is passed
     * and multiple terminals have the same name, uses the last one.
     * @param {Number|string} input the input terminal to examine
     */
    getInputTargets(input){
        //convert string to num
        if(typeof(input) === "string"){
            this.diagram.node_templates[this.template_name].inputs.forEach((inp,i)=>{
                if(inp != null && inp[0] === input){
                    input = i;
                }
            });
        }
        //if it's not a number, we have illegal state
        if(typeof(input) !== "number" || this.current_state.inputs[input] == null){
            return undefined;
        }
        //inputs[x] first entry is the target node
        return this.current_state.inputs[input][0];
    }

    
    //called when mouse dragging is done
    dragComplete(){
        //does nothing
    }

    
    /**
     * Populates the body of this according to the template it has
     */
    nodePopulate(){
        let node = this;
        let template = this.diagram.node_templates[this.template_name];

        let terminal_radius = node.diagram.MAGIC_TERMINAL_RADIUS;
        if(template == undefined){
            return;
        }
        //dimensions
        if(template.dimensions != null){
            node.body.style.width = template.dimensions[0]+"px";
            node.body.style.height = template.dimensions[1]+"px";
        }
        //body layout
        if(template.display != null){
            for(let [key, value] of Object.entries(template.display)){
                //create an entry for each key
                let entry = document.createElement("div");
                entry.setAttribute("class","node_entry");
                let label = document.createElement("label");
                label.setAttribute("class","node_label");
                let value = document.createAttribute("input");
                value.setAttribute("class","node_value");
                value.setAttribute("type",value);
        
                entry.appendChild(value);
                entry.appendChild(label);
                node.body.appendChild(entry);
            }
        }
        //inputs
        if(template.inputs != null){
            template.inputs.forEach((input,index)=>{
                if(input != null){
                    //circle
                    let y = node.diagram.nodeTerminalIndexOffset(index) - terminal_radius;
                    let circle = document.createElement("div");
                    circle.setAttribute("class", "dot-in");
                    circle.style.top = y+"px";
                    circle.style.setProperty("--terminal_index", index);
                    node.body.appendChild(circle);

                    //text
                    if(node.is_template){
                        //modifiable entry
                        let parent = document.createElement("div");//scrollable to contain both inputs
                        let name = document.createElement("input");
                        let type = document.createElement("input");
                        parent.style = "position: absolute; min-width: 75px; height:15px; overflow: auto; left: 4px;";
                        parent.style.top = (y-2)+"px";
                        type.style.top = "15px";
                        name.value = input[0];
                        type.value = input[1];
                        var onEntryChange = function(){
                            template.inputs[index] = [name.value,type.value];
                            node.diagram.onTemplateModify(node);
                        };
                        name.onchange = onEntryChange;
                        type.onchange = onEntryChange;
                        parent.appendChild(name);
                        parent.appendChild(type);
                        node.body.appendChild(parent);
                    }else{
                        //unmodifiable
                        let name = document.createElement("p");
                        name.style = "position:absolute; left: 15px; margin:0;";
                        name.setAttribute("class","tooltip");
                        name.innerHTML = input[0]+"<span class='spanright'>"+input[1]+"</span>";
                        name.style.top = (y-3)+"px";
                        node.body.appendChild(name);
                    }
                }
            });
        }
        //outputs
        if(template.outputs != null){
            template.outputs.forEach((output,index)=>{
                if(output != null){
                    //circle
                    let y = node.diagram.nodeTerminalIndexOffset(index) - terminal_radius;
                    let circle = document.createElement("div");
                    circle.setAttribute("class", "dot-out");
                    circle.style.top = y+"px";
                    circle.style.setProperty("--terminal_index", index);
                    node.body.appendChild(circle);
                    //text
                    if(node.is_template){
                        //modifiable entry
                        let parent = document.createElement("div");//scrollable to contain both inputs
                        let name = document.createElement("input");
                        let type = document.createElement("input");
                        parent.style = "position: absolute; min-width: 75px; height:15px; overflow: auto; right: 10px;";
                        parent.style.top = (y-2)+"px";
                        type.style.top = "15px";
                        name.value = output[0];
                        type.value = output[1];

                        //when either the name or the type is modified:
                        var onEntryChange = function(){
                            template.outputs[index] = [name.value,type.value];
                            node.diagram.onTemplateModify(node);
                        };

                        name.onchange = onEntryChange;
                        type.onchange = onEntryChange;
                        parent.appendChild(name);
                        parent.appendChild(type);
                        node.body.appendChild(parent);
                    }else{
                        //unmodifiable, name and show type on hover
                        let name = document.createElement("p");
                        name.style = "position:absolute; right: 15px; margin:0;";
                        name.setAttribute("class","tooltip");
                        name.innerHTML = output[0]+"<span class='spanleft'>"+output[1]+"</span>";
                        name.style.top = (y-3)+"px";
                        node.body.appendChild(name);
                    }
                }
            });
        }
        //parameters
        if(template.parameters != null){
            template.parameters.forEach((param,index) =>{
                if(param != null){
                    let y = node.diagram.nodeTerminalIndexOffset(index) - terminal_radius;
                    if(node.is_template){
                        let parent = document.createElement("div");//scrollable to contain input:
                        let parameter = document.createElement("textarea");//parameter data
                        parent.style = "position: absolute; width: 60%; left:20%;";
                        parent.style.top = (y-2)+"px";
                        parameter.value = JSON.stringify(param);
                        parent.appendChild(parameter);
                        node.body.appendChild(parent);
                        var onEntryChange = function(){
                            try{
                                template.parameters[index] = JSON.parse(parameter.value);
                                node.diagram.onTemplateModify(node);
                            }catch(e){}
                        };
                        parameter.onchange = onEntryChange;
                    }else{
                        let parent = document.createElement("div");//scrollable to contain input:
                        let name = document.createElement("p");//parameter data
                        parent.style = "position: absolute; width: 60%; height:15px; left:20%";
                        parent.style.top = (y-2)+"px";
                        
                        name.style = "position:absolute; left: 0; margin:0;";
                        name.setAttribute("class","tooltip");
                        name.innerHTML = param.name+(param.tooltip == null ? "": "<span class='spanleft'><small>"+param.tooltip+"</small></span>");

                        //vary entry based on type
                        var entry = null;
                        if(param.type == "boolean"){
                            entry = document.createElement("input");
                            entry.setAttribute("type","checkbox");
                        }else if(param.type == "dropdown"){
                            entry = document.createElement("select");
                            var dropdown = "";
                            param.options.forEach((option)=>{dropdown += "<option value='"+option+"'>"+option+"</option>";});
                            entry.innerHTML = dropdown;
                        }else if(param.type == "string_field"){
                            entry = document.createElement("input");
                        }else if(param.type == "num_field"){
                            entry = document.createElement("input");
                            entry.setAttribute("type","number");
                            if(param.min != null)
                                entry.setAttribute("min",param.min);
                            if(param.max != null)
                                entry.setAttribute("max",param.max);
                            if(param.step != null)
                                entry.setAttribute("step",param.step);
                            if(param.default != null)
                                entry.setAttribute("placeholder",param.default);
                        }
                        //set default value according to template
                        if(param.default != null){
                            if(param.type == "boolean"){
                                entry.checked = param.default;
                            }else{
                                entry.value = param.default;
                            }
                        }
                        //select and input types both have "value" and "select" attributes
                        if(node.current_state.parameters[index] != null){
                            entry.value = node.current_state.parameters[index];
                        }
                        //but checkboxes need the "checked" attribute to determine state
                        if(param.type == "boolean"){
                            entry.onchange = (e)=>{
                                node.current_state.parameters[index] = entry.checked;
                            }
                        }else{
                            entry.onchange = (e)=>{
                                //set node's state based on modified entry
                                node.current_state.parameters[index] = entry.value;
                            }
                        }
                        //take right half of parameter's div, with a lighter background
                        entry.style = "position:absolute; width: 50%; margin:0; left:50%; height: 100%; background-color: #ffffff30;";

                        parent.appendChild(entry);
                        parent.appendChild(name);
                        node.body.appendChild(parent);
                    }
                }
            });
        }
    }

}